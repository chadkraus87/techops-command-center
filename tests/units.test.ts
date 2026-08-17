import { describe, expect, it } from "vitest";
import {
  clamp,
  easeInOut,
  hashString,
  lerp,
  mulberry32,
  noiseAt,
  pickWeighted,
  smoothNoise,
} from "@/lib/sim/random";
import {
  deriveOwnStatus,
  derivePercentiles,
  diurnalFactor,
  impactProgress,
  propagateHealth,
  summariseFleet,
  worseOf,
} from "@/lib/sim/metrics";
import { evaluateAlerts } from "@/lib/sim/alerts";
import {
  diagnosisPoints,
  hintPenaltyFor,
  investigationPoints,
  penaltyFor,
  rankFor,
  remediationPoints,
  scoreIncident,
  speedPoints,
} from "@/lib/sim/scoring";
import { dnsIsBroken, executeCommand, resolveTarget } from "@/lib/sim/network";
import { ticketRateForTick } from "@/lib/sim/tickets";
import {
  abortScenario,
  applyRemediation,
  createInitialState,
  replayDuration,
  replayIncidentAt,
  revealHint,
  startScenario,
  tick,
} from "@/lib/sim/engine";
import { getScenario, SCENARIOS } from "@/lib/sim/scenarios";
import { getService, TOPO_ORDER, dependentsOf } from "@/lib/sim/services";
import { buildSeries, trendOf } from "@/lib/sim/history";
import { formatAvailability, formatCompact, formatDuration, formatLatency } from "@/lib/format";
import type { Impact, Incident, ServiceRuntime, SimState } from "@/lib/sim/types";

const EPOCH = Date.UTC(2026, 7, 11, 14, 2, 0);

function advance(state: SimState, seconds: number): SimState {
  let current = state;
  for (let i = 0; i < seconds; i++) current = tick(current, 1).state;
  return current;
}

// ---------------------------------------------------------------------------

describe("seeded randomness", () => {
  it("hashes strings stably", () => {
    expect(hashString("api-gateway")).toBe(hashString("api-gateway"));
    expect(hashString("api-gateway")).not.toBe(hashString("customer-api"));
  });

  it("produces the same value for the same seed and tick", () => {
    expect(noiseAt("cpu", 42)).toBe(noiseAt("cpu", 42));
    expect(noiseAt("cpu", 42)).not.toBe(noiseAt("cpu", 43));
  });

  it("stays within [0,1)", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("smooth noise wanders rather than jittering", () => {
    // Adjacent ticks should be close together — that is what makes telemetry
    // look like instrumentation instead of static.
    const a = smoothNoise("latency", 100, 12);
    const b = smoothNoise("latency", 101, 12);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
    expect(a).toBeGreaterThanOrEqual(-1);
    expect(a).toBeLessThanOrEqual(1);
  });

  it("weights picks by their weight", () => {
    const items = [
      { id: "common", weight: 100 },
      { id: "rare", weight: 1 },
    ];
    const picks = Array.from({ length: 200 }, (_, i) => pickWeighted(items, "t", i)?.id);
    const common = picks.filter((p) => p === "common").length;
    expect(common).toBeGreaterThan(150);
  });

  it("clamps and interpolates predictably", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------

describe("metric model", () => {
  it("traffic follows a daily curve", () => {
    const peak = diurnalFactor(Date.UTC(2026, 7, 11, 15, 0, 0));
    const trough = diurnalFactor(Date.UTC(2026, 7, 11, 3, 0, 0));
    expect(peak).toBeGreaterThan(trough);
    expect(trough).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("tail latency grows faster than median under pressure", () => {
    const def = getService("api-gateway");
    const calm = derivePercentiles({ latencyMs: 100, cpu: 30, errorRate: 0.001 }, def);
    const stressed = derivePercentiles({ latencyMs: 100, cpu: 95, errorRate: 0.2 }, def);

    // Same median, but the tail blows out when the service is saturated.
    expect(stressed.latencyP99! / stressed.latencyMs!).toBeGreaterThan(
      calm.latencyP99! / calm.latencyMs!,
    );
  });

  it("ramps impact in and unwinds it on recovery", () => {
    const impact: Impact = {
      service: "primary-db",
      metric: "cpu",
      mode: "set",
      value: 95,
      rampSeconds: 30,
    };

    expect(impactProgress(impact, 0, 0, 1)).toBe(0);
    expect(impactProgress(impact, 15, 0, 1)).toBeGreaterThan(0);
    expect(impactProgress(impact, 30, 0, 1)).toBeCloseTo(1, 1);
    // Recovery unwinds it back toward zero.
    expect(impactProgress(impact, 60, 30, 1)).toBeCloseTo(0, 1);
  });

  it("respects a propagation delay", () => {
    const delayed: Impact = {
      service: "customer-api",
      metric: "latencyMs",
      mode: "multiply",
      value: 5,
      delaySeconds: 20,
      rampSeconds: 20,
    };
    expect(impactProgress(delayed, 10, 0, 1)).toBe(0);
    expect(impactProgress(delayed, 30, 0, 1)).toBeGreaterThan(0);
  });

  it("derives status from SLO breaches with an explanation", () => {
    const def = getService("customer-api");

    const healthy = deriveOwnStatus(def, { latencyMs: 80, errorRate: 0.002, cpu: 40 }, true);
    expect(healthy.status).toBe("healthy");
    expect(healthy.reason).toBeNull();

    const degraded = deriveOwnStatus(def, { latencyMs: 700, errorRate: 0.002, cpu: 40 }, true);
    expect(degraded.status).toBe("degraded");
    expect(degraded.reason?.toLowerCase()).toContain("latency");

    const critical = deriveOwnStatus(def, { latencyMs: 80, errorRate: 0.4, cpu: 40 }, true);
    expect(critical.status).toBe("critical");

    const offline = deriveOwnStatus(def, { latencyMs: 80, errorRate: 0, cpu: 10 }, false);
    expect(offline.status).toBe("offline");
  });

  it("flags an exhausted connection pool", () => {
    const def = getService("primary-db");
    const result = deriveOwnStatus(def, { latencyMs: 12, errorRate: 0, cpu: 40, connections: 199 }, true);
    expect(result.status).toBe("critical");
    expect(result.reason?.toLowerCase()).toContain("connection pool");
  });

  it("orders statuses by severity", () => {
    expect(worseOf("healthy", "degraded")).toBe("degraded");
    expect(worseOf("critical", "degraded")).toBe("critical");
    expect(worseOf("offline", "critical")).toBe("offline");
  });
});

// ---------------------------------------------------------------------------

describe("health propagation", () => {
  function runtimeFor(overrides: Partial<Record<string, ServiceRuntime["status"]>>) {
    const base = createInitialState(EPOCH).services;
    const next = { ...base };
    for (const [id, status] of Object.entries(overrides)) {
      next[id as keyof typeof next] = { ...next[id as keyof typeof next], status: status! };
    }
    return next;
  }

  it("makes callers critical when a hard dependency goes offline", () => {
    const result = propagateHealth(runtimeFor({ "primary-db": "offline" }));
    expect(result["customer-api"].status).toBe("critical");
    expect(result["customer-api"].reason).toContain("Primary Database");
  });

  it("attenuates one level per hop", () => {
    const result = propagateHealth(runtimeFor({ "primary-db": "critical" }));
    // Direct caller degrades rather than going critical.
    expect(result["customer-api"].status).toBe("degraded");
  });

  it("only degrades callers when a soft dependency fails", () => {
    // Redis is a soft dependency of the gateway — losing it should slow, not kill.
    const result = propagateHealth(runtimeFor({ "redis-cache": "offline" }));
    expect(result["api-gateway"].status).toBe("degraded");
  });

  it("never improves a service that is already worse", () => {
    const result = propagateHealth(
      runtimeFor({ "primary-db": "critical", "customer-api": "offline" }),
    );
    expect(result["customer-api"].status).toBe("offline");
  });

  it("orders services after their dependencies so one pass settles", () => {
    const dbIndex = TOPO_ORDER.indexOf("primary-db");
    const apiIndex = TOPO_ORDER.indexOf("customer-api");
    const gatewayIndex = TOPO_ORDER.indexOf("api-gateway");
    expect(dbIndex).toBeLessThan(apiIndex);
    expect(apiIndex).toBeLessThan(gatewayIndex);
  });

  it("knows which services depend on a given service", () => {
    const dependents = dependentsOf("primary-db");
    expect(dependents).toContain("customer-api");
    expect(dependents).toContain("identity-service");
    expect(dependents).not.toContain("dns-resolver");
  });
});

// ---------------------------------------------------------------------------

describe("fleet summary", () => {
  it("reports operational when everything is healthy", () => {
    const fleet = summariseFleet(createInitialState(EPOCH).services);
    expect(fleet.status).toBe("operational");
    expect(fleet.servicesOnline).toBe(fleet.servicesTotal);
    expect(fleet.availability).toBeGreaterThan(0.99);
  });

  it("weights latency by traffic so quiet services cannot skew it", () => {
    const state = createInitialState(EPOCH);
    const fleet = summariseFleet(state.services);
    // Analytics has 480ms baseline latency but almost no traffic, so the
    // headline figure must stay far below it.
    expect(fleet.avgLatency).toBeLessThan(200);
  });

  it("escalates to major incident when a customer-facing service fails", () => {
    const state = advance(startScenario(createInitialState(EPOCH), "tls-expiry"), 60);
    expect(summariseFleet(state.services).status).toBe("major-incident");
  });
});

// ---------------------------------------------------------------------------

describe("alert evaluation", () => {
  it("does not fire until the condition has held for its window", () => {
    const state = createInitialState(EPOCH);
    const broken = {
      ...state.services,
      "customer-api": {
        ...state.services["customer-api"],
        metrics: { ...state.services["customer-api"].metrics, errorRate: 0.9 },
      },
    };

    // One second of breach is not enough.
    const first = evaluateAlerts(broken, [], {}, EPOCH, 1);
    expect(first.fired).toHaveLength(0);

    // Sustained breach eventually fires.
    let holds = first.holds;
    let alerts = first.alerts;
    let fired = 0;
    for (let i = 0; i < 40; i++) {
      const result = evaluateAlerts(broken, alerts, holds, EPOCH + i * 1000, 1);
      holds = result.holds;
      alerts = result.alerts;
      fired += result.fired.length;
    }
    expect(fired).toBeGreaterThan(0);
  });

  it("resets the hold window when the condition clears", () => {
    const state = createInitialState(EPOCH);
    const result = evaluateAlerts(state.services, [], { "customer-api:error-warning": 20 }, EPOCH, 1);
    expect(result.holds["customer-api:error-warning"]).toBe(0);
  });

  it("suppresses the warning rule when its critical twin fires", () => {
    const state = advance(startScenario(createInitialState(EPOCH), "tls-expiry"), 90);
    const open = state.alerts.filter((a) => a.resolvedAt === null);
    const gatewayErrorAlerts = open.filter(
      (a) => a.service === "api-gateway" && a.metric === "errorRate",
    );
    // One alert per problem, not two.
    expect(gatewayErrorAlerts.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("scoring", () => {
  it("rewards a first-attempt diagnosis and decays after that", () => {
    expect(diagnosisPoints(["dns-failure"], "dns-failure")).toBe(40);
    expect(diagnosisPoints(["cdn-issue", "dns-failure"], "dns-failure")).toBe(26);
    expect(diagnosisPoints(["a", "b", "dns-failure"], "dns-failure")).toBe(15);
    expect(diagnosisPoints(["a", "b"], "dns-failure")).toBe(0);
  });

  it("awards full speed points inside the target window", () => {
    expect(speedPoints(30, 60)).toBe(20);
    expect(speedPoints(60, 60)).toBe(20);
    expect(speedPoints(240, 60)).toBe(0);
    expect(speedPoints(null, 60)).toBe(0);
    // Between the two, points decay rather than dropping off a cliff.
    expect(speedPoints(120, 60)).toBeGreaterThan(0);
    expect(speedPoints(120, 60)).toBeLessThan(20);
  });

  it("caps investigation points at a thorough investigation", () => {
    expect(investigationPoints(0)).toBe(0);
    expect(investigationPoints(5)).toBe(15);
    expect(investigationPoints(20)).toBe(15);
  });

  it("scales remediation points by completion", () => {
    expect(remediationPoints([], ["a", "b"])).toBe(0);
    expect(remediationPoints(["a"], ["a", "b"])).toBe(13);
    expect(remediationPoints(["a", "b"], ["a", "b"])).toBe(25);
  });

  it("penalises unnecessary actions but caps the damage", () => {
    expect(penaltyFor([])).toBe(0);
    expect(penaltyFor(["x"])).toBe(8);
    expect(penaltyFor(["a", "b", "c", "d", "e", "f"])).toBe(30);
  });

  it("maps scores to ranks across the whole range", () => {
    expect(rankFor(100)).toBe("Site Reliability Expert");
    expect(rankFor(88)).toBe("Incident Commander");
    expect(rankFor(75)).toBe("Senior Troubleshooter");
    expect(rankFor(60)).toBe("Systems Analyst");
    expect(rankFor(45)).toBe("Support Specialist");
    expect(rankFor(10)).toBe("Junior Technician");
  });

  it("scores a flawless run highly and a sloppy one poorly", () => {
    const base: Incident = {
      id: "INC-1",
      scenarioId: "dns-failure",
      title: "DNS Resolution Failure",
      severity: "SEV-1",
      status: "resolved",
      startedAt: EPOCH,
      resolvedAt: EPOCH + 120_000,
      startedAtTick: 0,
      recoveryStartedAtElapsed: 90,
      affectedServices: [],
      customerImpact: "",
      timeline: [],
      rootCause: "",
      resolution: "",
      investigation: {
        diagnosisAttempts: ["dns-failure"],
        diagnosedAt: EPOCH + 40_000,
        correctDiagnosis: true,
        actionsTaken: ["restore-dns-zone", "flush-resolver-cache"],
        evidenceViewed: ["a", "b", "c", "d", "e"],
        remainingSteps: [],
        hintsRevealed: 0,
      },
    };

    const flawless = scoreIncident(base);
    expect(flawless.total).toBeGreaterThanOrEqual(95);
    expect(flawless.rank).toBe("Site Reliability Expert");
    expect(flawless.unnecessaryActions).toHaveLength(0);

    const sloppy = scoreIncident({
      ...base,
      investigation: {
        ...base.investigation,
        diagnosisAttempts: ["cdn-issue", "database-overload", "dns-failure"],
        diagnosedAt: EPOCH + 400_000,
        actionsTaken: ["restart-api-gateway", "failover-cdn", "restore-dns-zone", "flush-resolver-cache"],
        evidenceViewed: [],
      },
    });

    expect(sloppy.total).toBeLessThan(flawless.total);
    expect(sloppy.unnecessaryActions).toHaveLength(2);
    expect(sloppy.penalties).toBe(16);
  });

  it("never returns a score outside 0-100", () => {
    const terrible: Incident = {
      id: "INC-2",
      scenarioId: "dns-failure",
      title: "",
      severity: "SEV-1",
      status: "resolved",
      startedAt: EPOCH,
      resolvedAt: EPOCH + 900_000,
      startedAtTick: 0,
      recoveryStartedAtElapsed: null,
      affectedServices: [],
      customerImpact: "",
      timeline: [],
      rootCause: "",
      resolution: "",
      investigation: {
        diagnosisAttempts: [],
        diagnosedAt: null,
        correctDiagnosis: false,
        actionsTaken: ["a", "b", "c", "d", "e", "f", "g"],
        evidenceViewed: [],
        remainingSteps: ["restore-dns-zone"],
        hintsRevealed: 0,
      },
    };
    const score = scoreIncident(terrible);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------

describe("network tools", () => {
  it("resolves hostnames, aliases and IPs to the right service", () => {
    expect(resolveTarget("api.internal")?.service).toBe("api-gateway");
    expect(resolveTarget("10.20.30.21")?.service).toBe("primary-db");
    expect(resolveTarget("pg-primary-01.internal.meridian.io")?.service).toBe("primary-db");
    expect(resolveTarget("nope.invalid")).toBeNull();
  });

  it("reports DNS healthy in a healthy environment", () => {
    expect(dnsIsBroken(createInitialState(EPOCH))).toBe(false);
  });

  it("during a DNS incident, name lookups fail but IPs still ping", () => {
    // This contradiction is the evidence that solves the DNS scenario.
    const state = advance(startScenario(createInitialState(EPOCH), "dns-failure"), 60);
    expect(dnsIsBroken(state)).toBe(true);

    const byName = executeCommand("ping api.internal", state, state.tickCount);
    expect(byName.lines.some((l) => l.tone === "error")).toBe(true);

    const byIp = executeCommand("ping 10.20.12.44", state, state.tickCount);
    expect(byIp.lines.some((l) => l.tone === "ok")).toBe(true);

    const dig = executeCommand("dig api.internal", state, state.tickCount);
    expect(dig.lines.some((l) => l.text.includes("SERVFAIL"))).toBe(true);
  });

  it("answers a healthy lookup with an answer section", () => {
    const state = createInitialState(EPOCH);
    const result = executeCommand("dig customer-api.internal.meridian.io", state, 1);
    expect(result.lines.some((l) => l.text.includes("ANSWER SECTION"))).toBe(true);
    expect(result.lines.some((l) => l.text.includes("10.20.12.60"))).toBe(true);
  });

  it("reports packet loss in ping statistics", () => {
    const state = advance(startScenario(createInitialState(EPOCH), "packet-loss"), 90);
    const result = executeCommand("ping 10.20.30.21", state, state.tickCount);
    const stats = result.lines.find((l) => l.text.includes("packet loss"));
    expect(stats).toBeDefined();
  });

  it("records evidence for diagnostic commands only", () => {
    const state = createInitialState(EPOCH);
    expect(executeCommand("ping api.internal", state, 1).evidence).toBe("network:ping");
    expect(executeCommand("help", state, 1).evidence).toBeUndefined();
    expect(executeCommand("clear", state, 1).clear).toBe(true);
  });

  it("rejects unknown commands without throwing", () => {
    const state = createInitialState(EPOCH);
    const result = executeCommand("rm -rf /", state, 1);
    expect(result.lines.some((l) => l.text.includes("command not found"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("ticket arrival model", () => {
  it("produces almost nothing while healthy", () => {
    expect(ticketRateForTick(0, 0)).toBeLessThan(0.01);
  });

  it("stays silent for the first half-minute of an incident", () => {
    expect(ticketRateForTick(1, 10)).toBe(0);
    expect(ticketRateForTick(1, 30)).toBe(0);
  });

  it("builds as awareness spreads", () => {
    expect(ticketRateForTick(1, 60)).toBeGreaterThan(0);
    expect(ticketRateForTick(1, 130)).toBeGreaterThan(ticketRateForTick(1, 60));
  });
});

// ---------------------------------------------------------------------------

describe("chart history", () => {
  it("returns a full series for every range", () => {
    const state = advance(createInitialState(EPOCH), 30);
    for (const range of ["15m", "1h", "6h", "24h"] as const) {
      const series = buildSeries(state, "api-gateway", "latencyMs", range);
      expect(series.length).toBeGreaterThan(100);
      expect(series.every((p) => Number.isFinite(p.v))).toBe(true);
      // Time must increase left to right.
      expect(series[0].t).toBeLessThan(series[series.length - 1].t);
    }
  });

  it("computes a trend direction", () => {
    expect(trendOf([10, 20])).toBeCloseTo(1, 5);
    expect(trendOf([20, 10])).toBeCloseTo(-0.5, 5);
    expect(trendOf([5])).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("formatting", () => {
  it("scales latency units to magnitude", () => {
    expect(formatLatency(4.2)).toBe("4.20ms");
    expect(formatLatency(42)).toBe("42.0ms");
    expect(formatLatency(420)).toBe("420ms");
    expect(formatLatency(4200)).toBe("4.20s");
    expect(formatLatency(42000)).toBe("42.0s");
  });

  it("compacts large throughput figures", () => {
    expect(formatCompact(1400)).toBe("1.40k");
    expect(formatCompact(14000)).toBe("14.0k");
    expect(formatCompact(1_400_000)).toBe("1.4M");
  });

  it("gives availability enough precision to be meaningful", () => {
    expect(formatAvailability(0.9999)).toBe("99.990%");
    expect(formatAvailability(0.995)).toBe("99.50%");
  });

  it("formats durations in human units", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3700)).toBe("1h 1m");
  });
});

// ---------------------------------------------------------------------------

describe("guided mode hints", () => {
  it("gives every scenario three progressive hints", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.hints, scenario.id).toHaveLength(3);
      for (const hint of scenario.hints) {
        expect(hint.title.length, scenario.id).toBeGreaterThan(10);
        expect(hint.body.length, scenario.id).toBeGreaterThan(60);
      }
    }
  });

  it("never names the correct diagnosis outright", () => {
    // A hint that hands over the answer defeats the exercise. The third may
    // describe the mechanism, but must not match the selectable option label.
    for (const scenario of SCENARIOS) {
      const answer = scenario.diagnosisOptions
        .find((o) => o.id === scenario.correctDiagnosisId)!
        .label.toLowerCase();
      for (const hint of scenario.hints) {
        const text = `${hint.title} ${hint.body}`.toLowerCase();
        expect(text.includes(answer), `${scenario.id}: "${hint.title}"`).toBe(false);
      }
    }
  });

  it("reveals hints one at a time and stops at the last", () => {
    let state = startScenario(createInitialState(EPOCH), "dns-failure");
    const total = getScenario("dns-failure").hints.length;

    for (let i = 1; i <= total; i++) {
      state = revealHint(state);
      expect(state.incidents[0].investigation.hintsRevealed).toBe(i);
    }
    // Asking again cannot push the counter past what exists.
    state = revealHint(state);
    expect(state.incidents[0].investigation.hintsRevealed).toBe(total);
  });

  it("records each hint on the incident timeline", () => {
    const state = revealHint(startScenario(createInitialState(EPOCH), "redis-failure"));
    expect(state.incidents[0].timeline.some((e) => e.message.includes("Hint 1"))).toBe(true);
  });

  it("is a no-op with no active incident", () => {
    const healthy = createInitialState(EPOCH);
    expect(revealHint(healthy)).toBe(healthy);
  });

  it("costs 4 points per hint", () => {
    expect(hintPenaltyFor(0)).toBe(0);
    expect(hintPenaltyFor(1)).toBe(4);
    expect(hintPenaltyFor(3)).toBe(12);
  });

  it("costs less than flailing does", () => {
    // Taking all three hints must remain cheaper than two needless actions,
    // so guidance is never the worse strategic choice.
    expect(hintPenaltyFor(3)).toBeLessThan(penaltyFor(["a", "b"]));
  });

  it("survives a reload, so help taken still counts", () => {
    let state = startScenario(createInitialState(EPOCH), "dns-failure");
    state = revealHint(revealHint(state));
    state = advance(state, 5);
    expect(state.incidents[0].investigation.hintsRevealed).toBe(2);
  });

  it("deducts from the final score", () => {
    const base = startScenario(createInitialState(EPOCH), "dns-failure");
    const withHints = revealHint(revealHint(base));

    const resolved = (s: SimState) => ({
      ...s.incidents[0],
      resolvedAt: EPOCH + 120_000,
      investigation: {
        ...s.incidents[0].investigation,
        diagnosisAttempts: ["dns-failure"],
        diagnosedAt: EPOCH + 40_000,
        correctDiagnosis: true,
        actionsTaken: ["restore-dns-zone", "flush-resolver-cache"],
        evidenceViewed: ["a", "b", "c", "d", "e"],
        remainingSteps: [],
      },
    });

    const clean = scoreIncident(resolved(base));
    const hinted = scoreIncident(resolved(withHints));

    expect(hinted.hintsRevealed).toBe(2);
    expect(hinted.hintPenalty).toBe(8);
    expect(hinted.total).toBe(clean.total - 8);
  });
});

describe("hardening against tampered state", () => {
  // Investigation state can arrive from restored sessionStorage, which anyone
  // can hand-edit. None of it may reach the arithmetic unchecked.
  const tamperedIncident = (hintsRevealed: unknown): Incident => ({
    id: "INC-1",
    scenarioId: "dns-failure",
    title: "",
    severity: "SEV-1",
    status: "resolved",
    startedAt: EPOCH,
    resolvedAt: EPOCH + 120_000,
    startedAtTick: 0,
    recoveryStartedAtElapsed: 90,
    affectedServices: [],
    customerImpact: "",
    timeline: [],
    rootCause: "",
    resolution: "",
    investigation: {
      diagnosisAttempts: ["dns-failure"],
      diagnosedAt: EPOCH + 40_000,
      correctDiagnosis: true,
      actionsTaken: ["restore-dns-zone", "flush-resolver-cache"],
      evidenceViewed: ["a", "b", "c", "d", "e"],
      remainingSteps: [],
      hintsRevealed: hintsRevealed as number,
    },
  });

  it.each([["a string", "abc"], ["NaN", NaN], ["Infinity", Infinity], ["negative", -5], ["null", null]])(
    "never produces NaN from %s",
    (_label, value) => {
      const score = scoreIncident(tamperedIncident(value));
      expect(Number.isFinite(score.total)).toBe(true);
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
      expect(Number.isFinite(score.penalties)).toBe(true);
    },
  );

  it("treats a non-numeric hint count as zero", () => {
    expect(hintPenaltyFor("abc" as unknown as number)).toBe(0);
    expect(hintPenaltyFor(NaN)).toBe(0);
    expect(hintPenaltyFor(-3)).toBe(0);
  });

  it("increments rather than concatenates a tampered counter", () => {
    let state = startScenario(createInitialState(EPOCH), "dns-failure");
    state = {
      ...state,
      incidents: state.incidents.map((i) => ({
        ...i,
        investigation: { ...i.investigation, hintsRevealed: "2" as unknown as number },
      })),
    };
    // "2" + 1 would be "21" without the guard.
    expect(revealHint(state).incidents[0].investigation.hintsRevealed).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("incident replay", () => {
  /** Run a scenario to resolution so there is a complete incident to replay. */
  function resolvedRun() {
    let state = startScenario(createInitialState(EPOCH), "dns-failure");
    state = advance(state, 60);
    state = applyRemediation(state, "restore-dns-zone").state;
    state = advance(state, 20);
    state = applyRemediation(state, "flush-resolver-cache").state;
    state = advance(state, 140);
    return state;
  }

  it("records the two facts replay needs", () => {
    const state = resolvedRun();
    const incident = state.incidents[0];
    expect(incident.startedAtTick).toBe(0);
    expect(incident.recoveryStartedAtElapsed).not.toBeNull();
    expect(incident.status).toBe("resolved");
  });

  it("reconstructs a healthy environment at T+0", () => {
    const incident = resolvedRun().incidents[0];
    const frame = replayIncidentAt(incident, 0);
    expect(Object.values(frame.services).every((s) => s.status === "healthy")).toBe(true);
    // Detection is logged at T+0, so exactly that one event is visible.
    expect(frame.events).toHaveLength(1);
    expect(frame.events[0].kind).toBe("detection");
  });

  it("reconstructs the failure at its peak", () => {
    const incident = resolvedRun().incidents[0];
    const frame = replayIncidentAt(incident, 55);

    // The resolver is broken and the data tier is not — the scenario's signature.
    expect(frame.services["dns-resolver"].metrics.errorRate ?? 0).toBeGreaterThan(0.5);
    expect(frame.services["primary-db"].status).toBe("healthy");
    expect(frame.services["api-gateway"].status).not.toBe("healthy");
  });

  it("reconstructs recovery at the end", () => {
    const incident = resolvedRun().incidents[0];
    const frame = replayIncidentAt(incident, replayDuration(incident));
    expect(Object.values(frame.services).every((s) => s.status === "healthy")).toBe(true);
  });

  it("matches what actually happened at the same moment", () => {
    // The load-bearing property: a reconstructed frame must equal the live
    // state, or replay would be showing a plausible fiction.
    let live = startScenario(createInitialState(EPOCH), "database-overload");
    live = advance(live, 70);
    const incident = live.incidents[0];

    const frame = replayIncidentAt(incident, 70);

    for (const id of Object.keys(live.services) as Array<keyof typeof live.services>) {
      expect(frame.services[id].status, id).toBe(live.services[id].status);
      expect(frame.services[id].metrics.errorRate ?? 0, id).toBeCloseTo(
        live.services[id].metrics.errorRate ?? 0,
        6,
      );
      expect(frame.services[id].metrics.latencyMs ?? 0, id).toBeCloseTo(
        live.services[id].metrics.latencyMs ?? 0,
        6,
      );
    }
  });

  it("reveals timeline events progressively", () => {
    const incident = resolvedRun().incidents[0];
    const early = replayIncidentAt(incident, 5).events.length;
    const mid = replayIncidentAt(incident, 90).events.length;
    const end = replayIncidentAt(incident, replayDuration(incident)).events.length;

    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThanOrEqual(end);
    expect(end).toBe(incident.timeline.length);
  });

  it("clamps a negative position rather than extrapolating", () => {
    const incident = resolvedRun().incidents[0];
    expect(replayIncidentAt(incident, -50).elapsed).toBe(0);
  });

  it("is deterministic — the same position always rebuilds identically", () => {
    const incident = resolvedRun().incidents[0];
    expect(replayIncidentAt(incident, 42).services).toEqual(
      replayIncidentAt(incident, 42).services,
    );
  });

  it("gives an abandoned incident a replayable duration", () => {
    let state = startScenario(createInitialState(EPOCH), "redis-failure");
    state = advance(state, 40);
    state = abortScenario(state);
    const incident = state.incidents[0];

    expect(incident.recoveryStartedAtElapsed).toBeNull();
    expect(replayDuration(incident)).toBeGreaterThan(0);
    // Impacts never unwind, so the failure is still visible at the end.
    const frame = replayIncidentAt(incident, 40);
    expect(frame.services["redis-cache"].status).not.toBe("healthy");
  });
});
