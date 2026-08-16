"use client";

import { computeServices, rebuildHistory } from "@/lib/sim/engine";
import { findScenario } from "@/lib/sim/scenarios";
import type { SimState } from "@/lib/sim/types";

/**
 * Session persistence for the running simulation.
 *
 * The goal is that a page reload does not throw away an incident you are three
 * minutes into investigating.
 *
 * Only the *irreducible* state is stored — the clock, what the user did, and
 * the event records. Everything derivable is recomputed on restore:
 *
 *   - `services` come from `computeServices()`
 *   - `history` / `globalHistory` come from `rebuildHistory()`
 *
 * That is possible because the engine is deterministic, and it is why the
 * snapshot is ~100 KB rather than the several megabytes a naive `JSON.stringify`
 * of the whole state would produce. Recomputing is also *more* correct than
 * storing: there is no way for a stale buffer to disagree with the model.
 *
 * `sessionStorage`, not `localStorage`, is deliberate. A reload should resume;
 * a brand-new tab should get a clean environment to explore.
 */

const STORAGE_KEY = "techops.session.v1";

/** Bumped whenever the persisted shape changes, so old snapshots are ignored. */
const SCHEMA_VERSION = 1;

/** Logs are the bulkiest field; this many is plenty to preserve context. */
const MAX_PERSISTED_LOGS = 200;

/**
 * Fields that are stored verbatim. `services`, `history` and `globalHistory`
 * are deliberately absent — they are rebuilt.
 */
type PersistedSim = Pick<
  SimState,
  | "clock"
  | "elapsed"
  | "speed"
  | "tickCount"
  | "logs"
  | "alerts"
  | "tickets"
  | "incidents"
  | "deployments"
  | "active"
  | "ruleHoldSeconds"
  | "scheduledFailure"
>;

interface Envelope {
  version: number;
  savedAt: number;
  sim: PersistedSim;
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

export function saveSession(state: SimState): void {
  try {
    const envelope: Envelope = {
      version: SCHEMA_VERSION,
      savedAt: state.clock,
      sim: {
        clock: state.clock,
        elapsed: state.elapsed,
        speed: state.speed,
        tickCount: state.tickCount,
        logs: state.logs.slice(-MAX_PERSISTED_LOGS),
        alerts: state.alerts,
        tickets: state.tickets,
        incidents: state.incidents,
        deployments: state.deployments,
        active: state.active,
        ruleHoldSeconds: state.ruleHoldSeconds,
        scheduledFailure: state.scheduledFailure,
      },
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded or storage disabled. Persistence is a convenience, never a
    // requirement — the simulation carries on regardless.
  }
}

/**
 * Basic shape validation.
 *
 * The snapshot is attacker-controllable in the sense that anyone can edit their
 * own sessionStorage, so nothing from it is trusted: numbers are checked, arrays
 * are checked, and the scenario id is validated against the real catalogue
 * before it is ever passed to `getScenario()` (which throws on unknown ids).
 */
function isValid(envelope: unknown): envelope is Envelope {
  if (typeof envelope !== "object" || envelope === null) return false;
  const candidate = envelope as Partial<Envelope>;
  if (candidate.version !== SCHEMA_VERSION) return false;

  const sim = candidate.sim;
  if (typeof sim !== "object" || sim === null) return false;

  const numbers: Array<unknown> = [sim.clock, sim.elapsed, sim.tickCount, sim.speed];
  if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return false;
  if (sim.tickCount < 0 || sim.clock <= 0) return false;

  const arrays: Array<unknown> = [
    sim.logs,
    sim.alerts,
    sim.tickets,
    sim.incidents,
    sim.deployments,
  ];
  if (!arrays.every(Array.isArray)) return false;

  // An unknown or malformed scenario id would throw deep inside the engine.
  if (sim.active !== null && sim.active !== undefined) {
    if (typeof sim.active !== "object") return false;
    if (!findScenario(String(sim.active.scenarioId))) return false;
    if (typeof sim.active.elapsed !== "number" || !Number.isFinite(sim.active.elapsed)) return false;
  }

  if (sim.scheduledFailure != null && !findScenario(String(sim.scheduledFailure.scenarioId))) {
    return false;
  }

  return true;
}

/**
 * Restore a saved session on top of a freshly created state.
 *
 * `fresh` supplies anything the snapshot does not carry, so a snapshot written
 * by an older build can never leave the state missing a field.
 */
export function loadSession(fresh: SimState): SimState | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }

  if (!isValid(parsed)) {
    // Unrecognised or corrupt — discard rather than half-restore.
    clearSession();
    return null;
  }

  const { sim } = parsed;

  const restored: SimState = {
    ...fresh,
    clock: sim.clock,
    elapsed: sim.elapsed,
    tickCount: sim.tickCount,
    speed: sim.speed,
    // Always resume running: a paused simulation that silently stays paused
    // across a reload looks like the application is broken.
    running: true,
    logs: sim.logs,
    alerts: sim.alerts,
    tickets: sim.tickets,
    incidents: sim.incidents,
    deployments: sim.deployments,
    active: sim.active ?? null,
    ruleHoldSeconds: sim.ruleHoldSeconds ?? {},
    scheduledFailure: sim.scheduledFailure ?? null,
  };

  // Normalise counters that feed scoring arithmetic. Restored data is
  // user-editable, and a non-numeric value would propagate into the score.
  restored.incidents = restored.incidents.map((incident) => ({
    ...incident,
    investigation: {
      ...incident.investigation,
      hintsRevealed: Math.max(0, Math.floor(Number(incident.investigation?.hintsRevealed) || 0)),
      diagnosisAttempts: Array.isArray(incident.investigation?.diagnosisAttempts)
        ? incident.investigation.diagnosisAttempts
        : [],
      actionsTaken: Array.isArray(incident.investigation?.actionsTaken)
        ? incident.investigation.actionsTaken
        : [],
      evidenceViewed: Array.isArray(incident.investigation?.evidenceViewed)
        ? incident.investigation.evidenceViewed
        : [],
      remainingSteps: Array.isArray(incident.investigation?.remainingSteps)
        ? incident.investigation.remainingSteps
        : [],
    },
  }));

  // Derive everything that was not stored.
  restored.services = computeServices(restored, 0);
  const rebuilt = rebuildHistory(restored);
  restored.history = rebuilt.history;
  restored.globalHistory = rebuilt.globalHistory;

  return restored;
}

/** True when a resumable session exists. Used to explain the resume to the user. */
export function hasSession(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
