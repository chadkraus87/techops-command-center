import { describe, expect, it } from "vitest";
import {
  applyRemediation,
  createInitialState,
  currentIntensity,
  endScenario,
  resetEnvironment,
  startScenario,
  submitDiagnosis,
  tick,
  triggerDeployment,
} from "@/lib/sim/engine";
import { getScenario } from "@/lib/sim/scenarios";
import type { ScenarioId, SimState } from "@/lib/sim/types";

const EPOCH = Date.UTC(2026, 7, 11, 14, 2, 0);

/** Advance the simulation by a number of simulated seconds. */
function advance(state: SimState, seconds: number): SimState {
  let current = state;
  for (let i = 0; i < seconds; i++) {
    current = tick(current, 1).state;
  }
  return current;
}

/** Run a scenario forward from a fresh environment. */
function runScenario(scenarioId: ScenarioId, seconds: number): SimState {
  return advance(startScenario(createInitialState(EPOCH), scenarioId), seconds);
}

describe("initial state", () => {
  it("starts with every service healthy", () => {
    const state = createInitialState(EPOCH);
    const statuses = Object.values(state.services).map((s) => s.status);
    expect(statuses.every((s) => s === "healthy")).toBe(true);
  });

  it("starts with no incidents and no firing alerts", () => {
    const state = createInitialState(EPOCH);
    expect(state.incidents).toHaveLength(0);
    expect(state.alerts.filter((a) => a.resolvedAt === null)).toHaveLength(0);
    expect(state.active).toBeNull();
  });

  it("pre-fills chart history so charts open with a full trace", () => {
    const state = createInitialState(EPOCH);
    const series = state.history["api-gateway:latencyMs"];
    expect(series).toBeDefined();
    expect(series.length).toBeGreaterThan(200);
    expect(series.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("seeds a support backlog and log history so views are never empty", () => {
    const state = createInitialState(EPOCH);
    expect(state.tickets.length).toBeGreaterThan(0);
    expect(state.logs.length).toBeGreaterThan(0);
  });

  it("stays healthy when left running with no incident", () => {
    const state = advance(createInitialState(EPOCH), 180);
    const unhealthy = Object.values(state.services).filter((s) => s.status !== "healthy");
    expect(unhealthy).toHaveLength(0);
  });
});

describe("determinism", () => {
  // This is the load-bearing test: if it fails, no other test result is
  // meaningful, because the simulation would differ between runs.
  it("produces identical telemetry for identical inputs", () => {
    const runA = runScenario("database-overload", 90);
    const runB = runScenario("database-overload", 90);

    expect(runA.services).toEqual(runB.services);
    expect(runA.globalHistory).toEqual(runB.globalHistory);
    expect(runA.logs.map((l) => l.message)).toEqual(runB.logs.map((l) => l.message));
    expect(runA.alerts.map((a) => a.ruleId)).toEqual(runB.alerts.map((a) => a.ruleId));
  });

  it("advances the clock by exactly one simulated second per tick", () => {
    const state = advance(createInitialState(EPOCH), 60);
    expect(state.clock).toBe(EPOCH + 60_000);
    expect(state.elapsed).toBe(60);
    expect(state.tickCount).toBe(60);
  });

  it("respects a speed multiplier without changing per-tick work", () => {
    const fast = tick(createInitialState(EPOCH), 4).state;
    expect(fast.clock).toBe(EPOCH + 4000);
    expect(fast.tickCount).toBe(1);
  });
});

describe("incident lifecycle", () => {
  it("creates an incident record when a scenario starts", () => {
    const state = startScenario(createInitialState(EPOCH), "dns-failure");
    expect(state.incidents).toHaveLength(1);
    expect(state.active?.scenarioId).toBe("dns-failure");
    expect(state.incidents[0].status).toBe("investigating");
    expect(state.incidents[0].timeline.length).toBeGreaterThan(0);
  });

  it("ramps impact in over time rather than instantly", () => {
    const early = runScenario("dns-failure", 2);
    const later = runScenario("dns-failure", 45);
    expect(currentIntensity(early)).toBeLessThan(currentIntensity(later));
    expect(currentIntensity(later)).toBeGreaterThan(0.8);
  });

  it("declares the incident automatically once the threshold passes", () => {
    const scenario = getScenario("dns-failure");
    const state = runScenario("dns-failure", scenario.declareAfterSeconds + 5);
    const declared = state.incidents[0].timeline.some((e) => e.kind === "declaration");
    expect(declared).toBe(true);
  });

  it("clears the active scenario without wiping incident history", () => {
    const state = endScenario(runScenario("dns-failure", 30));
    expect(state.active).toBeNull();
    expect(state.incidents).toHaveLength(1);
  });
});

describe("scenario symptoms are coherent", () => {
  it("DNS failure breaks resolution while leaving data stores healthy", () => {
    const state = runScenario("dns-failure", 70);

    // The resolver is the thing that is actually broken.
    expect(state.services["dns-resolver"].metrics.errorRate ?? 0).toBeGreaterThan(0.5);
    // Data tier is provably fine — this is the discriminating evidence.
    expect(state.services["primary-db"].status).toBe("healthy");
    expect(state.services["redis-cache"].status).toBe("healthy");
    // Customer-facing services fail.
    expect(state.services["api-gateway"].status).not.toBe("healthy");
  });

  it("database overload saturates the pool and spares DNS", () => {
    const state = runScenario("database-overload", 100);
    const connections = state.services["primary-db"].metrics.connections ?? 0;

    expect(connections).toBeGreaterThan(180);
    expect(state.services["primary-db"].status).not.toBe("healthy");
    expect(state.services["dns-resolver"].status).toBe("healthy");
    // The cache absorbs load rather than failing.
    expect(state.services["redis-cache"].metrics.cacheHitRate ?? 0).toBeGreaterThan(0.9);
  });

  it("memory leak is slow, narrow, and does not raise throughput", () => {
    const early = runScenario("memory-leak", 30);
    const late = runScenario("memory-leak", 220);

    // Memory climbs steadily.
    expect(late.services["media-service"].metrics.memory ?? 0).toBeGreaterThan(
      early.services["media-service"].metrics.memory ?? 0,
    );
    expect(late.services["media-service"].metrics.memory ?? 0).toBeGreaterThan(88);

    // Resource use grew without extra work — the key discriminator.
    expect(late.services["media-service"].metrics.rps ?? 0).toBeLessThanOrEqual(
      (early.services["media-service"].metrics.rps ?? 0) * 1.2,
    );

    // Blast radius stays narrow.
    expect(late.services["primary-db"].status).toBe("healthy");
    expect(late.services["identity-service"].status).toBe("healthy");
  });

  it("redis failure amplifies load onto the database", () => {
    const state = runScenario("redis-failure", 80);
    expect(state.services["redis-cache"].metrics.cacheHitRate ?? 1).toBeLessThan(0.2);
    // The database takes the traffic the cache used to absorb.
    expect(state.services["primary-db"].metrics.rps ?? 0).toBeGreaterThan(
      (createInitialState(EPOCH).services["primary-db"].metrics.rps ?? 0) * 2,
    );
  });

  it("TLS expiry raises errors without raising latency", () => {
    const initial = createInitialState(EPOCH);
    const state = runScenario("tls-expiry", 40);

    expect(state.services["api-gateway"].metrics.errorRate ?? 0).toBeGreaterThan(0.5);
    // Failing fast is quick — latency falls rather than rising.
    expect(state.services["api-gateway"].metrics.latencyMs ?? 0).toBeLessThan(
      initial.services["api-gateway"].metrics.latencyMs ?? 0,
    );
  });

  it("packet loss registers on the affected subnet only", () => {
    const state = runScenario("packet-loss", 70);
    expect(state.services["primary-db"].metrics.packetLoss ?? 0).toBeGreaterThan(0.05);
    expect(state.services["edge-cdn"].metrics.packetLoss ?? 0).toBe(0);
  });

  it("third-party outage leaves every owned service healthy", () => {
    const state = runScenario("payment-provider-outage", 80);
    expect(state.services["payment-service"].status).not.toBe("healthy");
    expect(state.services["primary-db"].status).toBe("healthy");
    expect(state.services["customer-api"].status).toBe("healthy");
    expect(state.services["identity-service"].status).toBe("healthy");
  });
});

describe("reactive subsystems", () => {
  it("fires alerts once a condition has held long enough", () => {
    const early = runScenario("dns-failure", 8);
    const later = runScenario("dns-failure", 90);

    // Evaluation windows mean alerts lag the metric that caused them.
    expect(early.alerts.filter((a) => a.resolvedAt === null)).toHaveLength(0);
    expect(later.alerts.filter((a) => a.resolvedAt === null).length).toBeGreaterThan(0);
  });

  it("emits incident-specific log lines during an incident", () => {
    const state = runScenario("database-overload", 90);
    const incidentLogs = state.logs.filter((l) => l.incidentId);
    expect(incidentLogs.length).toBeGreaterThan(0);
    expect(
      incidentLogs.some((l) => l.level === "ERROR" || l.level === "CRITICAL"),
    ).toBe(true);
  });

  it("delays support tickets behind the technical symptoms", () => {
    const healthy = createInitialState(EPOCH);
    const early = runScenario("dns-failure", 25);
    const later = runScenario("dns-failure", 150);

    // Nobody has written in yet at 25 seconds.
    expect(early.tickets.filter((t) => t.incidentId)).toHaveLength(0);
    // By 150 seconds the queue is filling.
    expect(later.tickets.filter((t) => t.incidentId).length).toBeGreaterThan(0);
    expect(later.tickets.length).toBeGreaterThan(healthy.tickets.length);
  });

  it("caps log and ticket buffers so memory stays bounded", () => {
    const state = runScenario("dns-failure", 400);
    expect(state.logs.length).toBeLessThanOrEqual(600);
    expect(state.tickets.length).toBeLessThanOrEqual(80);
  });

  it("keeps metric history bounded", () => {
    const state = advance(createInitialState(EPOCH), 400);
    expect(state.history["api-gateway:latencyMs"].length).toBeLessThanOrEqual(240);
    expect(state.globalHistory.rps.length).toBeLessThanOrEqual(240);
  });
});

describe("dependency cascade", () => {
  it("attenuates blast radius by one level per hop", () => {
    // Postgres saturating should hit its direct callers harder than the edge.
    const state = runScenario("database-overload", 120);
    const db = state.services["primary-db"].status;
    const directCaller = state.services["customer-api"].status;
    const distant = state.services["edge-cdn"].status;

    expect(db).not.toBe("healthy");
    expect(directCaller).not.toBe("healthy");
    // Four hops away, the effect has faded.
    expect(distant).toBe("healthy");
  });
});

describe("diagnosis", () => {
  it("accepts the correct root cause and marks the incident identified", () => {
    const state = runScenario("dns-failure", 40);
    const result = submitDiagnosis(state, "dns-failure");

    expect(result.correct).toBe(true);
    expect(result.state.incidents[0].status).toBe("identified");
    expect(result.state.incidents[0].investigation.correctDiagnosis).toBe(true);
    expect(result.state.incidents[0].investigation.diagnosedAt).not.toBeNull();
  });

  it("returns coaching rather than the answer on a wrong diagnosis", () => {
    const state = runScenario("dns-failure", 40);
    const result = submitDiagnosis(state, "database-overload");

    expect(result.correct).toBe(false);
    expect(result.feedback.length).toBeGreaterThan(20);
    // The hint must not simply name the real cause.
    expect(result.feedback.toLowerCase()).not.toContain("dns resolution failure");
    expect(result.state.incidents[0].investigation.correctDiagnosis).toBe(false);
  });

  it("records every attempt in order", () => {
    let state = runScenario("dns-failure", 40);
    state = submitDiagnosis(state, "cdn-issue").state;
    state = submitDiagnosis(state, "dns-failure").state;

    expect(state.incidents[0].investigation.diagnosisAttempts).toEqual([
      "cdn-issue",
      "dns-failure",
    ]);
  });
});

describe("remediation and recovery", () => {
  it("does not recover from an ineffective action", () => {
    let state = runScenario("dns-failure", 60);
    state = applyRemediation(state, "restart-api-gateway").state;
    state = advance(state, 40);

    expect(state.active?.phase).not.toBe("recovering");
    expect(state.services["dns-resolver"].metrics.errorRate ?? 0).toBeGreaterThan(0.5);
  });

  it("requires every required step before recovery begins", () => {
    let state = runScenario("dns-failure", 60);

    // First required step alone is not enough.
    state = applyRemediation(state, "restore-dns-zone").state;
    state = advance(state, 20);
    expect(state.active?.phase).not.toBe("recovering");

    // Second required step starts recovery.
    state = applyRemediation(state, "flush-resolver-cache").state;
    state = advance(state, 20);
    expect(["recovering", "resolved"]).toContain(state.active?.phase);
  });

  it("restores the environment to healthy after correct remediation", () => {
    let state = runScenario("database-overload", 90);
    state = applyRemediation(state, "kill-long-queries").state;
    state = advance(state, 15);
    state = applyRemediation(state, "increase-connection-pool").state;
    state = advance(state, 140);

    expect(state.active?.phase).toBe("resolved");
    expect(state.incidents[0].status).toBe("resolved");
    expect(state.incidents[0].resolvedAt).not.toBeNull();

    const unhealthy = Object.values(state.services).filter((s) => s.status !== "healthy");
    expect(unhealthy).toHaveLength(0);
  });

  it("clears firing alerts once metrics return to baseline", () => {
    let state = runScenario("redis-failure", 90);
    expect(state.alerts.filter((a) => a.resolvedAt === null).length).toBeGreaterThan(0);

    state = applyRemediation(state, "restart-redis").state;
    state = advance(state, 130);

    expect(state.alerts.filter((a) => a.resolvedAt === null)).toHaveLength(0);
  });

  it("rejects a second action while one is already in flight", () => {
    let state = runScenario("dns-failure", 60);
    state = applyRemediation(state, "restore-dns-zone").state;
    const second = applyRemediation(state, "flush-resolver-cache");

    expect(second.accepted).toBe(false);
    expect(second.message).toMatch(/already in progress/i);
  });

  it("rejects remediation when there is no active incident", () => {
    const result = applyRemediation(createInitialState(EPOCH), "restore-dns-zone");
    expect(result.accepted).toBe(false);
  });
});

describe("deployments", () => {
  it("a safe deployment does not destabilise the environment", () => {
    let state = triggerDeployment(createInitialState(EPOCH), "customer-api", false);
    state = advance(state, 120);

    expect(state.scheduledFailure).toBeNull();
    expect(state.active).toBeNull();
    expect(Object.values(state.services).every((s) => s.status === "healthy")).toBe(true);
  });

  it("a risky deployment succeeds first and causes an incident later", () => {
    let state = triggerDeployment(createInitialState(EPOCH), "media-service", true);

    // It reports success immediately.
    expect(state.deployments[0].status).toBe("succeeded");
    expect(state.active).toBeNull();
    expect(state.scheduledFailure).not.toBeNull();

    // The incident only surfaces after the release has had time to bake.
    state = advance(state, 30);
    expect(state.active?.scenarioId).toBe("memory-leak");
  });
});

describe("reset", () => {
  it("restores a healthy baseline from a broken environment", () => {
    const broken = runScenario("dns-failure", 120);
    expect(Object.values(broken.services).some((s) => s.status !== "healthy")).toBe(true);

    const reset = resetEnvironment(EPOCH);

    expect(reset.active).toBeNull();
    expect(reset.incidents).toHaveLength(0);
    expect(reset.alerts.filter((a) => a.resolvedAt === null)).toHaveLength(0);
    expect(Object.values(reset.services).every((s) => s.status === "healthy")).toBe(true);
    expect(reset.clock).toBe(EPOCH);
  });
});
