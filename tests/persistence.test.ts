import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortScenario,
  createInitialState,
  rebuildHistory,
  replayIncidentAt,
  startScenario,
  tick,
} from "@/lib/sim/engine";
import type { ScenarioId, SimState } from "@/lib/sim/types";

/**
 * Session persistence and incident abandonment.
 *
 * The interesting property under test is that *nothing derivable is stored*:
 * the restore path recomputes services and chart history from the model, so
 * these tests assert the reconstruction is faithful rather than merely present.
 */

const EPOCH = Date.UTC(2026, 7, 11, 14, 2, 0);

function advance(state: SimState, seconds: number): SimState {
  let current = state;
  for (let i = 0; i < seconds; i++) current = tick(current, 1).state;
  return current;
}

function runScenario(scenarioId: ScenarioId, seconds: number): SimState {
  return advance(startScenario(createInitialState(EPOCH), scenarioId), seconds);
}

// ---------------------------------------------------------------------------
// A minimal sessionStorage stand-in, since the engine tests run in node.
// ---------------------------------------------------------------------------

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  get size() {
    return [...this.data.values()].reduce((sum, v) => sum + v.length, 0);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

// Imported after the global stub so the module sees a window.
async function persistence() {
  return import("@/lib/store/persistence");
}

describe("history reconstruction", () => {
  it("rebuilds buffers of the right shape", () => {
    const state = runScenario("database-overload", 90);
    const rebuilt = rebuildHistory(state);

    expect(rebuilt.history["primary-db:connections"]).toHaveLength(240);
    expect(rebuilt.globalHistory.rps).toHaveLength(240);
    expect(rebuilt.history["api-gateway:latencyMs"].every(Number.isFinite)).toBe(true);
  });

  it("reproduces the live buffer closely enough to be indistinguishable", () => {
    const state = runScenario("database-overload", 120);
    const rebuilt = rebuildHistory(state);

    const live = state.history["primary-db:connections"];
    const recomputed = rebuilt.history["primary-db:connections"];

    // The most recent sample is the one a user is actually looking at.
    expect(recomputed[recomputed.length - 1]).toBeCloseTo(live[live.length - 1], 5);
    // And the incident's ramp is preserved, not flattened to baseline.
    expect(recomputed[recomputed.length - 1]).toBeGreaterThan(recomputed[0]);
  });

  it("keeps a healthy environment flat", () => {
    const state = advance(createInitialState(EPOCH), 60);
    const rebuilt = rebuildHistory(state);
    const series = rebuilt.history["api-gateway:errorRate"];
    expect(Math.max(...series)).toBeLessThan(0.05);
  });
});

describe("session persistence", () => {
  it("round-trips an in-progress incident", async () => {
    const { saveSession, loadSession } = await persistence();

    const original = runScenario("dns-failure", 75);
    saveSession(original);

    const restored = loadSession(createInitialState(EPOCH));
    expect(restored).not.toBeNull();

    expect(restored!.clock).toBe(original.clock);
    expect(restored!.tickCount).toBe(original.tickCount);
    expect(restored!.active?.scenarioId).toBe("dns-failure");
    expect(restored!.active?.elapsed).toBe(original.active?.elapsed);
    expect(restored!.incidents[0].id).toBe(original.incidents[0].id);
    expect(restored!.incidents[0].timeline.length).toBe(original.incidents[0].timeline.length);
  });

  it("recomputes service health identically rather than storing it", async () => {
    const { saveSession, loadSession } = await persistence();

    const original = runScenario("dns-failure", 75);
    saveSession(original);
    const restored = loadSession(createInitialState(EPOCH))!;

    for (const id of Object.keys(original.services) as Array<keyof typeof original.services>) {
      expect(restored.services[id].status).toBe(original.services[id].status);
      expect(restored.services[id].metrics.errorRate).toBeCloseTo(
        original.services[id].metrics.errorRate ?? 0,
        6,
      );
    }
  });

  it("preserves investigation progress across a reload", async () => {
    const { saveSession, loadSession } = await persistence();

    let state = runScenario("database-overload", 80);
    state = {
      ...state,
      incidents: state.incidents.map((i) => ({
        ...i,
        investigation: {
          ...i.investigation,
          diagnosisAttempts: ["cache-failure", "database-overload"],
          correctDiagnosis: true,
          evidenceViewed: ["logs:viewed", "alerts:viewed"],
        },
      })),
    };

    saveSession(state);
    const restored = loadSession(createInitialState(EPOCH))!;

    expect(restored.incidents[0].investigation.correctDiagnosis).toBe(true);
    expect(restored.incidents[0].investigation.diagnosisAttempts).toEqual([
      "cache-failure",
      "database-overload",
    ]);
    expect(restored.incidents[0].investigation.evidenceViewed).toHaveLength(2);
  });

  it("stays far below the storage quota", async () => {
    const { saveSession } = await persistence();
    // A long-running incident is the worst case for buffer sizes.
    saveSession(runScenario("dns-failure", 400));
    // sessionStorage limits are typically 5 MB; stay an order of magnitude under.
    expect(storage.size).toBeLessThan(500_000);
  });

  it("returns null when there is nothing saved", async () => {
    const { loadSession } = await persistence();
    expect(loadSession(createInitialState(EPOCH))).toBeNull();
  });

  it("discards corrupt data instead of throwing", async () => {
    const { loadSession } = await persistence();
    storage.setItem("techops.session.v1", "{not json");
    expect(loadSession(createInitialState(EPOCH))).toBeNull();
    expect(storage.getItem("techops.session.v1")).toBeNull();
  });

  it("rejects a snapshot from an unknown schema version", async () => {
    const { loadSession } = await persistence();
    storage.setItem("techops.session.v1", JSON.stringify({ version: 99, sim: {} }));
    expect(loadSession(createInitialState(EPOCH))).toBeNull();
  });

  it("rejects a tampered scenario id rather than crashing the engine", async () => {
    const { saveSession, loadSession } = await persistence();
    saveSession(runScenario("dns-failure", 40));

    const raw = JSON.parse(storage.getItem("techops.session.v1")!);
    raw.sim.active.scenarioId = "../../etc/passwd";
    storage.setItem("techops.session.v1", JSON.stringify(raw));

    // getScenario() throws on unknown ids, so validation must catch this first.
    expect(() => loadSession(createInitialState(EPOCH))).not.toThrow();
    expect(loadSession(createInitialState(EPOCH))).toBeNull();
  });

  it("rejects non-finite numbers", async () => {
    const { saveSession, loadSession } = await persistence();
    saveSession(runScenario("dns-failure", 40));

    const raw = JSON.parse(storage.getItem("techops.session.v1")!);
    raw.sim.tickCount = "not a number";
    storage.setItem("techops.session.v1", JSON.stringify(raw));

    expect(loadSession(createInitialState(EPOCH))).toBeNull();
  });

  it("clears on request", async () => {
    const { saveSession, clearSession, hasSession } = await persistence();
    saveSession(runScenario("dns-failure", 30));
    expect(hasSession()).toBe(true);
    clearSession();
    expect(hasSession()).toBe(false);
  });

  it("resumes running even if the simulation was paused when saved", async () => {
    const { saveSession, loadSession } = await persistence();
    const paused = { ...runScenario("dns-failure", 30), running: false };
    saveSession(paused);
    expect(loadSession(createInitialState(EPOCH))!.running).toBe(true);
  });
});

describe("abandoning an incident", () => {
  it("clears the active scenario and returns services to baseline", () => {
    const broken = runScenario("dns-failure", 90);
    expect(Object.values(broken.services).some((s) => s.status !== "healthy")).toBe(true);

    // Abandoning stops the impacts; the next tick recomputes from baseline.
    const cleared = advance(abortScenario(broken), 2);

    expect(cleared.active).toBeNull();
    expect(Object.values(cleared.services).every((s) => s.status === "healthy")).toBe(true);
  });

  it("records the run as abandoned rather than resolved", () => {
    const cleared = abortScenario(runScenario("dns-failure", 90));
    const incident = cleared.incidents[0];

    expect(incident.status).toBe("resolved");
    expect(incident.resolvedAt).not.toBeNull();
    expect(incident.timeline.some((e) => e.message.includes("abandoned"))).toBe(true);
    // It must not look like a successful remediation.
    expect(incident.investigation.actionsTaken).toHaveLength(0);
    expect(incident.investigation.correctDiagnosis).toBe(false);
  });

  it("clears firing alerts so the queue does not keep stale entries", () => {
    const broken = runScenario("dns-failure", 90);
    expect(broken.alerts.filter((a) => a.resolvedAt === null).length).toBeGreaterThan(0);

    const cleared = abortScenario(broken);
    expect(cleared.alerts.filter((a) => a.resolvedAt === null)).toHaveLength(0);
  });

  it("is a no-op when nothing is running", () => {
    const healthy = createInitialState(EPOCH);
    expect(abortScenario(healthy)).toBe(healthy);
  });

  it("leaves the environment usable for another scenario immediately", () => {
    const cleared = advance(abortScenario(runScenario("redis-failure", 80)), 2);
    const next = advance(startScenario(cleared, "tls-expiry"), 40);

    expect(next.active?.scenarioId).toBe("tls-expiry");
    expect(next.incidents).toHaveLength(2);
    expect(next.services["api-gateway"].status).not.toBe("healthy");
  });
});

describe("hardening restored incidents", () => {
  it("drops an incident referencing an unknown scenario instead of crashing", async () => {
    const { saveSession, loadSession } = await persistence();
    saveSession(runScenario("dns-failure", 60));

    const raw = JSON.parse(storage.getItem("techops.session.v1")!);
    raw.sim.incidents[0].scenarioId = "deleted-scenario";
    storage.setItem("techops.session.v1", JSON.stringify(raw));

    // getScenario() throws on unknown ids and is reached from seven call sites
    // (scoring, replay, the incidents page…), so this must never get through.
    const restored = loadSession(createInitialState(EPOCH));
    expect(() => loadSession(createInitialState(EPOCH))).not.toThrow();
    expect(restored!.incidents).toHaveLength(0);
    // The pointer to it must go too, or the UI renders a phantom incident.
    expect(restored!.active).toBeNull();
  });

  it("normalises replay counters that would otherwise yield NaN telemetry", async () => {
    const { saveSession, loadSession } = await persistence();
    saveSession(runScenario("dns-failure", 60));

    const raw = JSON.parse(storage.getItem("techops.session.v1")!);
    raw.sim.incidents[0].startedAtTick = "not a number";
    raw.sim.incidents[0].recoveryStartedAtElapsed = "also not";
    storage.setItem("techops.session.v1", JSON.stringify(raw));

    const restored = loadSession(createInitialState(EPOCH))!;
    expect(restored.incidents[0].startedAtTick).toBe(0);
    expect(restored.incidents[0].recoveryStartedAtElapsed).toBeNull();

    const frame = replayIncidentAt(restored.incidents[0], 30);
    expect(Number.isFinite(frame.services["api-gateway"].metrics.latencyMs ?? NaN)).toBe(true);
  });

  it("replay is defensive even if a bad incident reaches it directly", () => {
    const incident = runScenario("dns-failure", 40).incidents[0];
    for (const bad of [NaN, Infinity, "x" as unknown as number, -1]) {
      const frame = replayIncidentAt({ ...incident, startedAtTick: bad }, 20);
      expect(Number.isFinite(frame.services["primary-db"].metrics.cpu ?? NaN)).toBe(true);
    }
    // A non-finite scrub position clamps rather than producing NaN.
    expect(replayIncidentAt(incident, NaN).elapsed).toBe(0);
  });
});
