import { evaluateAlerts } from "./alerts";
import { generateLogs, MAX_LOG_ENTRIES, seedLogHistory } from "./logs";
import {
  applyImpact,
  baselineMetrics,
  derivePercentiles,
  deriveOwnStatus,
  impactProgress,
  propagateHealth,
  summariseFleet,
} from "./metrics";
import { generateTickets, MAX_TICKETS, resetTicketCounter, seedTickets } from "./tickets";
import { getScenario, SCENARIOS } from "./scenarios";
import { getService, SERVICES } from "./services";
import { clamp } from "./random";
import { seedDeployments } from "./deployments";
import type {
  Alert,
  Incident,
  LogEntry,
  MetricKey,
  MetricSnapshot,
  Scenario,
  ScenarioId,
  ServiceId,
  ServiceRuntime,
  SimState,
  TimelineEvent,
} from "./types";

/**
 * The simulation engine.
 *
 * Every function here is pure: state in, state out, no timers and no I/O. The
 * store owns the clock and calls `tick`; the engine only ever describes what the
 * world looks like one second later. That separation is what makes the whole
 * simulation testable without rendering anything.
 */

/** How many live samples each metric series retains (4 minutes at 1x). */
export const HISTORY_LENGTH = 240;

/** Metrics worth charting — percentiles are derived, so they aren't stored. */
const HISTORY_METRICS: MetricKey[] = [
  "latencyMs",
  "errorRate",
  "rps",
  "cpu",
  "memory",
  "connections",
  "cacheHitRate",
  "queueDepth",
];

/** Assumed prior uptime so availability figures start out plausible. */
const SEEDED_UPTIME_SECONDS = 30 * 24 * 60 * 60;

let timelineCounter = 0;

function timelineEvent(
  timestamp: number,
  kind: TimelineEvent["kind"],
  message: string,
  actor?: string,
): TimelineEvent {
  return { id: `tl-${timestamp}-${timelineCounter++}`, timestamp, kind, message, actor };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(clock: number): SimState {
  resetTicketCounter();

  const services = {} as Record<ServiceId, ServiceRuntime>;
  for (const def of SERVICES) {
    const metrics = derivePercentiles(baselineMetrics(def, 0, clock), def);
    services[def.id] = {
      id: def.id,
      status: "healthy",
      metrics,
      reachable: true,
      uptimeSeconds: SEEDED_UPTIME_SECONDS,
      // Seed just enough historical downtime to match the advertised SLO.
      downtimeSeconds: Math.round(SEEDED_UPTIME_SECONDS * (1 - def.slo.availability)),
      reason: null,
    };
  }

  const history: Record<string, number[]> = {};
  for (const def of SERVICES) {
    for (const metric of HISTORY_METRICS) {
      const value = services[def.id].metrics[metric];
      if (value === undefined) continue;
      // Pre-fill the buffer so charts open with a full, believable trace rather
      // than a single point crawling in from the left.
      history[`${def.id}:${metric}`] = Array.from({ length: HISTORY_LENGTH }, (_, i) => {
        const past = derivePercentiles(
          baselineMetrics(def, i - HISTORY_LENGTH, clock - (HISTORY_LENGTH - i) * 1000),
          def,
        );
        return past[metric] ?? value;
      });
    }
  }

  const fleet = summariseFleet(services);
  const globalHistory = {
    rps: Array.from({ length: HISTORY_LENGTH }, (_, i) => {
      let total = 0;
      for (const def of SERVICES) {
        if (!def.customerFacing) continue;
        total += baselineMetrics(def, i - HISTORY_LENGTH, clock - (HISTORY_LENGTH - i) * 1000).rps ?? 0;
      }
      return total;
    }),
    latency: Array.from({ length: HISTORY_LENGTH }, () => fleet.avgLatency),
    errorRate: Array.from({ length: HISTORY_LENGTH }, () => fleet.errorRate),
    tickets: Array.from({ length: HISTORY_LENGTH }, () => 0),
  };

  return {
    clock,
    elapsed: 0,
    running: true,
    speed: 1,
    tickCount: 0,
    services,
    logs: seedLogHistory(clock),
    alerts: [],
    tickets: seedTickets(clock),
    incidents: [],
    deployments: seedDeployments(clock),
    requests: [],
    active: null,
    history,
    globalHistory,
    ruleHoldSeconds: {},
    scheduledFailure: null,
  };
}

// ---------------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------------

type ImpactAppliers = Map<ServiceId, Array<(s: MetricSnapshot) => MetricSnapshot>>;

/**
 * The impacts in force at a given point in the scenario, grouped by service.
 *
 * `secondsAgo` lets the same function describe the past as well as the present.
 * Because impact progress is a pure function of elapsed time, rewinding is just
 * arithmetic — which is what makes it possible to reconstruct chart history
 * exactly after a page reload, rather than storing it.
 */
function impactsAt(active: SimState["active"], secondsAgo = 0): ImpactAppliers {
  const grouped: ImpactAppliers = new Map();
  if (!active) return grouped;

  const elapsed = active.elapsed - secondsAgo;
  if (elapsed <= 0) return grouped;
  const recoveryElapsed = Math.max(0, active.recoveryElapsed - secondsAgo);

  const scenario = getScenario(active.scenarioId);
  for (const impact of scenario.impacts) {
    const progress = impactProgress(impact, elapsed, recoveryElapsed, active.intensity);
    if (progress <= 0.0001) continue;
    const list = grouped.get(impact.service) ?? [];
    list.push((s) => applyImpact(s, impact, progress));
    grouped.set(impact.service, list);
  }
  return grouped;
}

/**
 * Clamp a snapshot to physically sensible ranges and derive its percentiles.
 * Shared by the live tick and by history reconstruction so the two can never
 * drift apart.
 */
function finaliseMetrics(def: (typeof SERVICES)[number], raw: MetricSnapshot): MetricSnapshot {
  const metrics: MetricSnapshot = {
    ...raw,
    errorRate: clamp(raw.errorRate ?? 0, 0, 1),
    cpu: clamp(raw.cpu ?? 0, 0, 100),
    memory: clamp(raw.memory ?? 0, 0, 100),
    latencyMs: Math.max(0.1, raw.latencyMs ?? 0),
    rps: Math.max(0, raw.rps ?? 0),
    ...(raw.cacheHitRate !== undefined ? { cacheHitRate: clamp(raw.cacheHitRate, 0, 1) } : {}),
    ...(raw.packetLoss !== undefined ? { packetLoss: clamp(raw.packetLoss, 0, 1) } : {}),
    ...(raw.connections !== undefined
      ? { connections: Math.max(0, Math.round(raw.connections)) }
      : {}),
    ...(raw.queueDepth !== undefined ? { queueDepth: Math.max(0, Math.round(raw.queueDepth)) } : {}),
  };
  return derivePercentiles(metrics, def);
}

/** Every service's metrics at a point `secondsAgo` before the current tick. */
function metricsAt(state: SimState, secondsAgo: number): Record<ServiceId, MetricSnapshot> {
  const impacts = impactsAt(state.active, secondsAgo);
  const tick = state.tickCount - secondsAgo;
  const clock = state.clock - secondsAgo * 1000;
  const out = {} as Record<ServiceId, MetricSnapshot>;

  for (const def of SERVICES) {
    let metrics = baselineMetrics(def, tick, clock);
    for (const apply of impacts.get(def.id) ?? []) metrics = apply(metrics);
    out[def.id] = finaliseMetrics(def, metrics);
  }
  return out;
}

/** Services the active scenario has taken entirely offline. */
function unreachableServices(state: SimState): Set<ServiceId> {
  const out = new Set<ServiceId>();
  const active = state.active;
  if (!active || active.recoveryElapsed > 0) return out;
  const scenario = getScenario(active.scenarioId);
  for (const entry of scenario.unreachable ?? []) {
    if (active.elapsed >= (entry.delaySeconds ?? 0)) out.add(entry.service);
  }
  return out;
}

/** Compute every service's metrics and health for the current tick. */
export function computeServices(state: SimState, dtSeconds: number): Record<ServiceId, ServiceRuntime> {
  const impacts = impactsAt(state.active, 0);
  const unreachable = unreachableServices(state);
  const next = {} as Record<ServiceId, ServiceRuntime>;

  for (const def of SERVICES) {
    let raw = baselineMetrics(def, state.tickCount, state.clock);
    for (const apply of impacts.get(def.id) ?? []) raw = apply(raw);
    const metrics = finaliseMetrics(def, raw);

    const reachable = !unreachable.has(def.id);
    const { status, reason } = deriveOwnStatus(def, metrics, reachable);
    const previous = state.services[def.id];

    next[def.id] = {
      id: def.id,
      status,
      metrics,
      reachable,
      uptimeSeconds: (previous?.uptimeSeconds ?? SEEDED_UPTIME_SECONDS) + dtSeconds,
      downtimeSeconds:
        (previous?.downtimeSeconds ?? 0) +
        (status === "offline" || status === "critical"
          ? dtSeconds
          : status === "degraded"
            ? dtSeconds * 0.25
            : 0),
      reason,
    };
  }

  return propagateHealth(next);
}

// ---------------------------------------------------------------------------
// Scenario progression
// ---------------------------------------------------------------------------

interface ProgressionResult {
  active: SimState["active"];
  events: TimelineEvent[];
  /** Set when the incident's status should change. */
  incidentStatus?: Incident["status"];
  /** Set on the tick recovery begins, for replay reconstruction. */
  recoveryStartedAtElapsed?: number;
}

function advanceScenario(state: SimState, dtSeconds: number): ProgressionResult {
  const active = state.active;
  if (!active) return { active: null, events: [] };

  const scenario = getScenario(active.scenarioId);
  const events: TimelineEvent[] = [];
  let next = { ...active, elapsed: active.elapsed + dtSeconds };
  let incidentStatus: Incident["status"] | undefined;
  let recoveryStartedAtElapsed: number | undefined;

  // A remediation action in flight ticks down before anything else happens.
  if (next.pendingAction) {
    const remaining = next.pendingAction.remainingSeconds - dtSeconds;
    if (remaining > 0) {
      next = { ...next, pendingAction: { ...next.pendingAction, remainingSeconds: remaining } };
    } else {
      const actionId = next.pendingAction.id;
      const option = scenario.remediationOptions.find((o) => o.id === actionId);
      const isRequired = scenario.requiredRemediationIds.includes(actionId);
      const remainingSteps = next.pendingAction
        ? state.incidents
            .find((i) => i.id === active.incidentId)
            ?.investigation.remainingSteps.filter((s) => s !== actionId) ?? []
        : [];

      events.push(
        timelineEvent(
          state.clock,
          "remediation",
          isRequired
            ? `Applied: ${option?.label ?? actionId} — completed successfully`
            : `Applied: ${option?.label ?? actionId} — no measurable improvement`,
          "You",
        ),
      );

      // Recovery begins only when every required step has been applied.
      if (isRequired && remainingSteps.length === 0) {
        next = { ...next, pendingAction: null, phase: "recovering", recoveryElapsed: 0.0001 };
        incidentStatus = "monitoring";
        recoveryStartedAtElapsed = next.elapsed;
        events.push(
          timelineEvent(state.clock, "recovery", "Remediation complete — metrics returning to baseline", "System"),
        );
      } else {
        // The action finished but did not fix anything — the incident carries on.
        next = { ...next, pendingAction: null, phase: "sustained" };
        if (option && !isRequired) {
          events.push(timelineEvent(state.clock, "note", option.ineffectiveNote, "System"));
        }
      }
    }
  }

  // Phase transitions driven purely by elapsed time.
  if (next.phase === "ramping") {
    const fullyRamped = scenario.impacts.every(
      (i) => next.elapsed >= (i.delaySeconds ?? 0) + (i.rampSeconds ?? 30),
    );
    if (fullyRamped) next = { ...next, phase: "sustained" };
  }

  if (next.phase === "recovering") {
    next = { ...next, recoveryElapsed: next.recoveryElapsed + dtSeconds };
    if (next.recoveryElapsed >= scenario.recoverySeconds) {
      next = { ...next, phase: "resolved", recoveryElapsed: scenario.recoverySeconds };
      incidentStatus = "resolved";
      events.push(
        timelineEvent(state.clock, "resolution", "All services healthy — incident resolved", "System"),
      );
    }
  }

  // Automatic declaration, once, at the scenario's declaration threshold.
  const incident = state.incidents.find((i) => i.id === active.incidentId);
  const alreadyDeclared = incident?.timeline.some((e) => e.kind === "declaration");
  if (!alreadyDeclared && next.elapsed >= scenario.declareAfterSeconds) {
    events.push(
      timelineEvent(
        state.clock,
        "declaration",
        `Incident declared ${scenario.severity} — ${scenario.title}`,
        "Auto-detection",
      ),
    );
  }

  return { active: next, events, incidentStatus, recoveryStartedAtElapsed };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function pushSample(series: number[] | undefined, value: number): number[] {
  const base = series ?? [];
  const next = base.length >= HISTORY_LENGTH ? base.slice(base.length - HISTORY_LENGTH + 1) : base.slice();
  next.push(value);
  return next;
}

function updateHistory(
  history: Record<string, number[]>,
  services: Record<ServiceId, ServiceRuntime>,
): Record<string, number[]> {
  const next: Record<string, number[]> = { ...history };
  for (const def of SERVICES) {
    const runtime = services[def.id];
    for (const metric of HISTORY_METRICS) {
      const value = runtime.metrics[metric];
      if (value === undefined) continue;
      const key = `${def.id}:${metric}`;
      next[key] = pushSample(next[key], value);
    }
  }
  return next;
}

/**
 * Reconstruct the rolling chart history for a state that has none.
 *
 * Used after a page reload: rather than persisting ~25,000 numbers, the buffers
 * are recomputed by evaluating the metric model at each of the last
 * HISTORY_LENGTH ticks. Because both the baseline model and impact progress are
 * pure functions of elapsed time, the result is identical to what the live
 * simulation would have produced — the charts pick up exactly where they left
 * off, with the incident's ramp intact.
 */
export function rebuildHistory(state: SimState): Pick<SimState, "history" | "globalHistory"> {
  const history: Record<string, number[]> = {};
  const globalRps: number[] = [];
  const globalLatency: number[] = [];
  const globalError: number[] = [];

  for (let i = HISTORY_LENGTH - 1; i >= 0; i--) {
    const snapshot = metricsAt(state, i);

    for (const def of SERVICES) {
      const metrics = snapshot[def.id];
      for (const metric of HISTORY_METRICS) {
        const value = metrics[metric];
        if (value === undefined) continue;
        const key = `${def.id}:${metric}`;
        (history[key] ??= []).push(value);
      }
    }

    // Fleet aggregates use the same traffic weighting as summariseFleet.
    let weightedLatency = 0;
    let weightedErrors = 0;
    let totalRps = 0;
    for (const def of SERVICES) {
      if (!def.customerFacing) continue;
      const metrics = snapshot[def.id];
      const rps = metrics.rps ?? 0;
      weightedLatency += (metrics.latencyMs ?? 0) * rps;
      weightedErrors += (metrics.errorRate ?? 0) * rps;
      totalRps += rps;
    }
    globalRps.push(totalRps);
    globalLatency.push(totalRps > 0 ? weightedLatency / totalRps : 0);
    globalError.push(totalRps > 0 ? weightedErrors / totalRps : 0);
  }

  return {
    history,
    globalHistory: {
      rps: globalRps,
      latency: globalLatency,
      errorRate: globalError,
      // Ticket arrivals are event counts, not a sampled metric, so there is
      // nothing to reconstruct — the buffer simply restarts empty.
      tickets: Array.from({ length: HISTORY_LENGTH }, () => 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayFrame {
  /** Seconds since the incident began. */
  elapsed: number;
  clock: number;
  services: Record<ServiceId, ServiceRuntime>;
  /** Timeline events that had happened by this point. */
  events: TimelineEvent[];
}

/**
 * Reconstruct any moment of a past incident.
 *
 * This exists because the engine is pure and deterministic: telemetry is a
 * function of (tick, clock, elapsed), so reaching an arbitrary point costs one
 * evaluation rather than replaying the run. No frames are recorded during the
 * incident — only two numbers are (`startedAtTick` and
 * `recoveryStartedAtElapsed`), and everything else is derived on demand.
 *
 * Health cascade is applied exactly as it is live, so a replayed frame is
 * indistinguishable from the original.
 */
export function replayIncidentAt(incident: Incident, elapsedSeconds: number): ReplayFrame {
  // Defensive: an incident can arrive from restored storage, and a non-finite
  // value here would silently produce NaN telemetry rather than failing loudly.
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const startedAtTick = Number.isFinite(incident.startedAtTick)
    ? Math.max(0, Math.floor(incident.startedAtTick))
    : 0;
  const clock = incident.startedAt + elapsed * 1000;

  const recoveryStart = Number.isFinite(incident.recoveryStartedAtElapsed as number)
    ? (incident.recoveryStartedAtElapsed as number)
    : null;
  const recoveryElapsed = recoveryStart === null ? 0 : Math.max(0, elapsed - recoveryStart);

  // A synthetic `active` describing the scenario at that instant.
  const active: SimState["active"] = {
    scenarioId: incident.scenarioId,
    incidentId: incident.id,
    startedAt: incident.startedAt,
    elapsed,
    phase: recoveryElapsed > 0 ? "recovering" : "sustained",
    intensity: 1,
    recoveryElapsed,
    pendingAction: null,
  };

  const impacts = impactsAt(active, 0);
  const scenario = getScenario(incident.scenarioId);
  const unreachable = new Set<ServiceId>();
  if (recoveryElapsed === 0) {
    for (const entry of scenario.unreachable ?? []) {
      if (elapsed >= (entry.delaySeconds ?? 0)) unreachable.add(entry.service);
    }
  }

  const services = {} as Record<ServiceId, ServiceRuntime>;
  for (const def of SERVICES) {
    let raw = baselineMetrics(def, startedAtTick + elapsed, clock);
    for (const apply of impacts.get(def.id) ?? []) raw = apply(raw);
    const metrics = finaliseMetrics(def, raw);

    const reachable = !unreachable.has(def.id);
    const { status, reason } = deriveOwnStatus(def, metrics, reachable);
    services[def.id] = {
      id: def.id,
      status,
      metrics,
      reachable,
      // Uptime counters are not meaningful for a single reconstructed frame.
      uptimeSeconds: SEEDED_UPTIME_SECONDS,
      downtimeSeconds: 0,
      reason,
    };
  }

  return {
    elapsed,
    clock,
    services: propagateHealth(services),
    events: incident.timeline.filter((event) => event.timestamp <= clock),
  };
}

/** Total seconds a replay can scrub across. */
export function replayDuration(incident: Incident): number {
  const end = incident.resolvedAt ?? incident.startedAt;
  // Give a resolved incident a short tail so the recovered state is visible.
  return Math.max(1, Math.round((end - incident.startedAt) / 1000) + 10);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export interface TickResult {
  state: SimState;
  /** Side effects the UI may want to surface as toasts. */
  notifications: Array<{ kind: "alert" | "incident" | "recovery" | "ticket"; message: string; severity: "critical" | "warning" | "info" | "success" }>;
}

/** Advance the simulation by `dtSeconds` of simulated time. */
export function tick(state: SimState, dtSeconds = 1): TickResult {
  const notifications: TickResult["notifications"] = [];

  const clock = state.clock + dtSeconds * 1000;
  const working: SimState = {
    ...state,
    clock,
    elapsed: state.elapsed + dtSeconds,
    tickCount: state.tickCount + 1,
  };

  // 1. Scenario progression (may start recovery or resolve the incident).
  const progression = advanceScenario(working, dtSeconds);
  working.active = progression.active;

  // 2. Metrics and health.
  working.services = computeServices(working, dtSeconds);

  // 3. Alerts.
  const intensityNow = currentIntensity(working);
  const evaluation = evaluateAlerts(
    working.services,
    working.alerts,
    working.ruleHoldSeconds,
    clock,
    dtSeconds,
    working.active?.incidentId,
  );
  working.alerts = evaluation.alerts;
  working.ruleHoldSeconds = evaluation.holds;

  // 4. Logs.
  const latencyByService: Partial<Record<ServiceId, number>> = {};
  for (const def of SERVICES) {
    latencyByService[def.id] = working.services[def.id].metrics.latencyMs;
  }
  const scenario = working.active ? getScenario(working.active.scenarioId) : null;
  const newLogs = generateLogs({
    tick: working.tickCount,
    clock,
    intensity: intensityNow,
    scenarioTemplates: scenario?.logTemplates ?? [],
    incidentId: working.active?.incidentId,
    latencyByService,
  });
  working.logs = [...working.logs, ...newLogs].slice(-MAX_LOG_ENTRIES);

  // 5. Support tickets.
  const newTickets = generateTickets({
    tick: working.tickCount,
    clock,
    intensity: intensityNow,
    elapsedSeconds: working.active?.elapsed ?? 0,
    templates: scenario?.ticketTemplates ?? [],
    incidentId: working.active?.incidentId,
  });
  if (newTickets.length > 0) {
    working.tickets = [...newTickets, ...working.tickets].slice(0, MAX_TICKETS);
  }

  // 6. History.
  working.history = updateHistory(working.history, working.services);
  const fleet = summariseFleet(working.services);
  working.globalHistory = {
    rps: pushSample(working.globalHistory.rps, fleet.totalRps),
    latency: pushSample(working.globalHistory.latency, fleet.avgLatency),
    errorRate: pushSample(working.globalHistory.errorRate, fleet.errorRate),
    tickets: pushSample(working.globalHistory.tickets, newTickets.length),
  };

  // 7. Incident timeline — alerts and progression events both land here.
  const timelineAdditions: TimelineEvent[] = [...progression.events];
  for (const alert of evaluation.fired) {
    if (alert.severity === "critical" || working.active) {
      timelineAdditions.push(
        timelineEvent(clock, "alert", `Alert fired: ${alert.title} — ${alert.detail}`, "Monitoring"),
      );
    }
    notifications.push({
      kind: "alert",
      message: `${alert.title}`,
      severity: alert.severity === "critical" ? "critical" : "warning",
    });
  }
  for (const alert of evaluation.cleared) {
    if (alert.severity === "critical") {
      notifications.push({ kind: "recovery", message: `Cleared: ${alert.title}`, severity: "success" });
    }
  }

  const incidentId = working.active?.incidentId;
  if (incidentId && (timelineAdditions.length > 0 || progression.incidentStatus)) {
    const nextStatus = progression.incidentStatus;
    working.incidents = working.incidents.map((incident) =>
      incident.id === incidentId
        ? {
            ...incident,
            timeline:
              timelineAdditions.length > 0
                ? [...incident.timeline, ...timelineAdditions]
                : incident.timeline,
            status: nextStatus ?? incident.status,
            resolvedAt: nextStatus === "resolved" ? clock : incident.resolvedAt,
            recoveryStartedAtElapsed:
              progression.recoveryStartedAtElapsed ?? incident.recoveryStartedAtElapsed,
          }
        : incident,
    );
  }

  if (progression.incidentStatus === "resolved") {
    notifications.push({
      kind: "recovery",
      message: "Incident resolved — all services healthy",
      severity: "success",
    });
  }

  // 8. A deployment scheduled to fail eventually becomes a real incident.
  if (working.scheduledFailure) {
    const remaining = working.scheduledFailure.inSeconds - dtSeconds;
    if (remaining <= 0) {
      const scheduled = working.scheduledFailure;
      working.scheduledFailure = null;
      if (!working.active) {
        const started = startScenario(working, scheduled.scenarioId);
        return { state: started, notifications: [
          ...notifications,
          { kind: "incident", message: "Deployment has destabilised the environment", severity: "critical" },
        ] };
      }
    } else {
      working.scheduledFailure = { ...working.scheduledFailure, inSeconds: remaining };
    }
  }

  return { state: working, notifications };
}

/** How far into an incident the environment currently is, 0..1. */
export function currentIntensity(state: SimState): number {
  const active = state.active;
  if (!active) return 0;
  const scenario = getScenario(active.scenarioId);
  // Use the scenario's fastest-ramping impact as the reference curve.
  const reference = scenario.impacts.reduce(
    (min, impact) => {
      const total = (impact.delaySeconds ?? 0) + (impact.rampSeconds ?? 30);
      return total < min ? total : min;
    },
    Number.POSITIVE_INFINITY,
  );
  const rampIn = clamp(active.elapsed / Math.max(reference, 1), 0, 1);
  const unwound =
    active.recoveryElapsed > 0
      ? clamp(active.recoveryElapsed / Math.max(scenario.recoverySeconds, 1), 0, 1)
      : 0;
  return clamp(rampIn * active.intensity * (1 - unwound), 0, 1);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

let incidentCounter = 1042;

/** Begin a scenario. Creates the incident record and its opening timeline. */
export function startScenario(state: SimState, scenarioId: ScenarioId): SimState {
  const scenario = getScenario(scenarioId);
  const incidentId = `INC-${incidentCounter++}`;

  const incident: Incident = {
    id: incidentId,
    scenarioId,
    title: scenario.title,
    severity: scenario.severity,
    status: "investigating",
    startedAt: state.clock,
    resolvedAt: null,
    startedAtTick: state.tickCount,
    recoveryStartedAtElapsed: null,
    affectedServices: scenario.affectedServices,
    customerImpact: scenario.customerImpact,
    timeline: [
      timelineEvent(state.clock, "detection", "Anomaly detected in production telemetry", "Monitoring"),
    ],
    rootCause: scenario.rootCause,
    resolution: scenario.resolution,
    investigation: {
      diagnosisAttempts: [],
      diagnosedAt: null,
      correctDiagnosis: false,
      actionsTaken: [],
      evidenceViewed: [],
      remainingSteps: [...scenario.requiredRemediationIds],
      hintsRevealed: 0,
    },
  };

  return {
    ...state,
    active: {
      scenarioId,
      incidentId,
      startedAt: state.clock,
      elapsed: 0,
      phase: "ramping",
      intensity: 1,
      recoveryElapsed: 0,
      pendingAction: null,
    },
    incidents: [incident, ...state.incidents],
  };
}

export interface DiagnosisResult {
  state: SimState;
  correct: boolean;
  feedback: string;
}

/** Submit a root-cause diagnosis. Wrong answers cost points but teach. */
export function submitDiagnosis(state: SimState, optionId: string): DiagnosisResult {
  const active = state.active;
  if (!active) return { state, correct: false, feedback: "No active incident." };

  const scenario = getScenario(active.scenarioId);
  const option = scenario.diagnosisOptions.find((o) => o.id === optionId);
  const correct = optionId === scenario.correctDiagnosisId;

  const events: TimelineEvent[] = [
    timelineEvent(
      state.clock,
      "diagnosis",
      correct
        ? `Root cause identified: ${option?.label ?? optionId}`
        : `Diagnosis submitted: ${option?.label ?? optionId} — ruled out`,
      "You",
    ),
  ];

  const incidents = state.incidents.map((incident) =>
    incident.id === active.incidentId
      ? {
          ...incident,
          status: correct ? ("identified" as const) : incident.status,
          timeline: [...incident.timeline, ...events],
          investigation: {
            ...incident.investigation,
            diagnosisAttempts: [...incident.investigation.diagnosisAttempts, optionId],
            diagnosedAt: correct ? state.clock : incident.investigation.diagnosedAt,
            correctDiagnosis: correct || incident.investigation.correctDiagnosis,
          },
        }
      : incident,
  );

  return {
    state: { ...state, incidents },
    correct,
    feedback: correct
      ? "Correct. Now choose the remediation that actually addresses this."
      : (option?.feedback ?? "Not the cause. Keep investigating."),
  };
}

export interface RemediationResult {
  state: SimState;
  accepted: boolean;
  message: string;
}

/** Apply a remediation action. Takes simulated time to complete. */
export function applyRemediation(state: SimState, actionId: string): RemediationResult {
  const active = state.active;
  if (!active) return { state, accepted: false, message: "No active incident." };
  if (active.pendingAction) {
    return { state, accepted: false, message: "Another action is already in progress." };
  }
  if (active.phase === "recovering" || active.phase === "resolved") {
    return { state, accepted: false, message: "The incident is already recovering." };
  }

  const scenario = getScenario(active.scenarioId);
  const option = scenario.remediationOptions.find((o) => o.id === actionId);
  if (!option) return { state, accepted: false, message: "Unknown action." };

  const incidents = state.incidents.map((incident) =>
    incident.id === active.incidentId
      ? {
          ...incident,
          timeline: [
            ...incident.timeline,
            timelineEvent(state.clock, "remediation", `Started: ${option.label}`, "You"),
          ],
          investigation: {
            ...incident.investigation,
            actionsTaken: [...incident.investigation.actionsTaken, actionId],
            remainingSteps: incident.investigation.remainingSteps.filter((s) => s !== actionId),
          },
        }
      : incident,
  );

  return {
    state: {
      ...state,
      incidents,
      active: {
        ...active,
        phase: "remediating",
        pendingAction: { id: actionId, remainingSeconds: option.durationSeconds },
      },
    },
    accepted: true,
    message: `${option.label} — in progress (${option.durationSeconds}s)`,
  };
}

/**
 * Reveal the next hint.
 *
 * Recorded on the incident rather than in UI state so it survives a reload and
 * still costs points afterwards — taking help you then "forget" would make the
 * score meaningless.
 */
export function revealHint(state: SimState): SimState {
  const active = state.active;
  if (!active) return state;

  const scenario = getScenario(active.scenarioId);

  return {
    ...state,
    incidents: state.incidents.map((incident) => {
      if (incident.id !== active.incidentId) return incident;
      // Number() guards against a tampered restore, where `x + 1` on a string
      // would concatenate instead of increment.
      const current = Number(incident.investigation.hintsRevealed);
      const next = (Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0) + 1;
      if (next > scenario.hints.length) return incident;
      return {
        ...incident,
        timeline: [
          ...incident.timeline,
          timelineEvent(state.clock, "note", `Hint ${next} revealed: ${scenario.hints[next - 1].title}`, "You"),
        ],
        investigation: { ...incident.investigation, hintsRevealed: next },
      };
    }),
  };
}

/** Record that the user actually looked at a piece of evidence. Feeds scoring. */
export function recordEvidence(state: SimState, evidenceId: string): SimState {
  const active = state.active;
  if (!active) return state;
  return {
    ...state,
    incidents: state.incidents.map((incident) =>
      incident.id === active.incidentId &&
      !incident.investigation.evidenceViewed.includes(evidenceId)
        ? {
            ...incident,
            investigation: {
              ...incident.investigation,
              evidenceViewed: [...incident.investigation.evidenceViewed, evidenceId],
            },
          }
        : incident,
    ),
  };
}

/** Acknowledge an alert so it drops out of the active triage list. */
export function acknowledgeAlert(state: SimState, alertId: string): SimState {
  return {
    ...state,
    alerts: state.alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
  };
}

/** Clear the active scenario without resetting the whole environment. */
export function endScenario(state: SimState): SimState {
  return { ...state, active: null };
}

/**
 * Abandon an incident in progress.
 *
 * Distinct from `endScenario` (which just dismisses a finished run) and from a
 * full environment reset. The incident is closed honestly — recorded as
 * abandoned rather than resolved, so it cannot be mistaken for a successful run
 * in the incident history — and the impacts stop immediately, letting every
 * service snap back to its baseline.
 */
export function abortScenario(state: SimState): SimState {
  const active = state.active;
  if (!active) return state;

  return {
    ...state,
    active: null,
    incidents: state.incidents.map((incident) =>
      incident.id === active.incidentId
        ? {
            ...incident,
            status: "resolved" as const,
            resolvedAt: state.clock,
            timeline: [
              ...incident.timeline,
              timelineEvent(
                state.clock,
                "note",
                "Incident abandoned — environment restored to baseline without remediation",
                "You",
              ),
            ],
          }
        : incident,
    ),
    // Alerts for a cleared incident should not linger in the triage queue.
    alerts: state.alerts.map((alert) =>
      alert.resolvedAt === null ? { ...alert, resolvedAt: state.clock } : alert,
    ),
    ruleHoldSeconds: {},
  };
}

/** Deploy a service. `shouldFail` schedules a real incident a little later. */
export function triggerDeployment(
  state: SimState,
  serviceId: ServiceId,
  shouldFail: boolean,
): SimState {
  const def = getService(serviceId);
  const [major, minor, patch] = def.version.replace(/^\D+/, "").split(".").map(Number);
  const nextVersion =
    Number.isFinite(major) && Number.isFinite(minor) && Number.isFinite(patch)
      ? `${major}.${minor}.${(patch ?? 0) + 1}`
      : `${def.version}+1`;

  const deployment = {
    id: `dep-${state.clock}`,
    service: serviceId,
    version: nextVersion,
    deployedAt: state.clock,
    status: "succeeded" as const,
    author: def.owner,
    testsPassed: shouldFail ? 216 : 218,
    testsFailed: shouldFail ? 2 : 0,
    coverage: shouldFail ? 81.4 : 88.2,
    regressionRisk: shouldFail ? ("high" as const) : ("low" as const),
    changelog: shouldFail
      ? [
          "Rework thumbnail buffer pool for faster transcoding",
          "Skip flaky memory-pressure test in CI",
          "Bump image codec dependency",
        ]
      : ["Dependency updates", "Improve error messages on validation failures"],
  };

  return {
    ...state,
    deployments: [deployment, ...state.deployments],
    // The leak takes a while to become visible — that delay is the whole point.
    scheduledFailure: shouldFail ? { scenarioId: "memory-leak", inSeconds: 20 } : state.scheduledFailure,
  };
}

/** Restore the environment to a healthy baseline. */
export function resetEnvironment(clock: number): SimState {
  incidentCounter = 1042;
  timelineCounter = 0;
  return createInitialState(clock);
}

// ---------------------------------------------------------------------------
// Selectors used across the UI
// ---------------------------------------------------------------------------

export function activeIncident(state: SimState): Incident | null {
  if (!state.active) return null;
  return state.incidents.find((i) => i.id === state.active?.incidentId) ?? null;
}

export function activeScenario(state: SimState): Scenario | null {
  return state.active ? getScenario(state.active.scenarioId) : null;
}

export function unresolvedAlerts(state: SimState): Alert[] {
  return state.alerts.filter((a) => a.resolvedAt === null);
}

export function recentLogs(state: SimState, count: number): LogEntry[] {
  return state.logs.slice(-count).reverse();
}

export const ALL_SCENARIOS = SCENARIOS;
