import { getService, SERVICES, serviceName, TOPO_ORDER } from "./services";
import { clamp, easeInOut, smoothNoise } from "./random";
import type {
  HealthStatus,
  Impact,
  MetricKey,
  MetricSnapshot,
  ServiceDef,
  ServiceId,
  ServiceRuntime,
} from "./types";

/**
 * The metric layer. Everything visible in the product is derived from here:
 * service health, alerts, topology edge colour, API percentiles and the shape
 * of every chart. Two inputs only — a deterministic baseline model and the set
 * of impacts an active scenario is currently applying.
 */

/** Simulated seconds per tick. One tick is one second of simulated time. */
export const SECONDS_PER_TICK = 1;

/**
 * Traffic follows a daily curve, peaking mid-afternoon and troughing overnight.
 * Without this, every chart is a flat line with noise on it and the environment
 * reads as fake immediately.
 */
export function diurnalFactor(clock: number): number {
  const date = new Date(clock);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  // Peak at 15:00 UTC, trough at 03:00 UTC.
  const phase = ((hours - 15) / 24) * Math.PI * 2;
  return 0.62 + 0.38 * ((Math.cos(phase) + 1) / 2);
}

/**
 * The healthy-state reading for a service. Pure: the same tick always yields
 * the same numbers.
 */
export function baselineMetrics(def: ServiceDef, tick: number, clock: number): MetricSnapshot {
  const b = def.baseline;
  const traffic = diurnalFactor(clock);

  const rps = b.rps * traffic * (1 + smoothNoise(`${def.id}:rps`, tick, 14) * 0.06);
  const latency = b.latencyMs * (1 + smoothNoise(`${def.id}:lat`, tick, 9) * 0.12);
  const errorRate = Math.max(
    0,
    b.errorRate * (1 + smoothNoise(`${def.id}:err`, tick, 20) * 0.35),
  );
  // CPU tracks traffic — a service under more load genuinely works harder.
  const cpu = clamp(
    b.cpu * (0.75 + traffic * 0.35) + smoothNoise(`${def.id}:cpu`, tick, 11) * 4,
    1,
    100,
  );
  const memory = clamp(b.memory + smoothNoise(`${def.id}:mem`, tick, 40) * 3, 1, 100);

  const snapshot: MetricSnapshot = { rps, latencyMs: latency, errorRate, cpu, memory };

  if (b.connections !== undefined) {
    snapshot.connections = Math.round(
      b.connections * (0.8 + traffic * 0.35) + smoothNoise(`${def.id}:conn`, tick, 10) * 6,
    );
  }
  if (b.cacheHitRate !== undefined) {
    snapshot.cacheHitRate = clamp(
      b.cacheHitRate + smoothNoise(`${def.id}:hit`, tick, 25) * 0.015,
      0,
      1,
    );
  }
  if (b.queueDepth !== undefined) {
    snapshot.queueDepth = Math.max(
      0,
      Math.round(b.queueDepth * (0.7 + traffic * 0.5) + smoothNoise(`${def.id}:q`, tick, 8) * 18),
    );
  }
  if (b.diskUsage !== undefined) {
    // Disk creeps upward slowly over the session, as real disks do.
    snapshot.diskUsage = clamp(b.diskUsage + tick / 4000, 0, 100);
  }
  if (b.packetLoss !== undefined) {
    snapshot.packetLoss = Math.max(0, b.packetLoss);
  } else {
    snapshot.packetLoss = 0;
  }

  return snapshot;
}

/**
 * How much of an impact is currently applied, in 0..1.
 *
 * `elapsed` is seconds since the scenario started. Effects ramp in after their
 * delay, hold, then unwind over the recovery window — which is why a recovering
 * system does not snap back to healthy the instant you fix it.
 */
export function impactProgress(
  impact: Impact,
  elapsed: number,
  recoveryElapsed: number,
  intensity: number,
): number {
  const delay = impact.delaySeconds ?? 0;
  const ramp = impact.rampSeconds ?? 30;
  const since = elapsed - delay;
  if (since <= 0) return 0;

  const rampIn = easeInOut(clamp(since / Math.max(ramp, 1), 0, 1));

  if (recoveryElapsed <= 0) return rampIn * intensity;

  const recovery = impact.recoverySeconds ?? ramp;
  const unwound = easeInOut(clamp(recoveryElapsed / Math.max(recovery, 1), 0, 1));
  return rampIn * intensity * (1 - unwound);
}

/** Apply one impact to a snapshot at the given progress. */
export function applyImpact(
  snapshot: MetricSnapshot,
  impact: Impact,
  progress: number,
): MetricSnapshot {
  if (progress <= 0) return snapshot;
  const current = snapshot[impact.metric];
  if (current === undefined) return snapshot;

  let next: number;
  switch (impact.mode) {
    case "multiply":
      next = current * (1 + (impact.value - 1) * progress);
      break;
    case "add":
      next = current + impact.value * progress;
      break;
    case "set":
      next = current + (impact.value - current) * progress;
      break;
  }

  return { ...snapshot, [impact.metric]: next };
}

/**
 * Tail latency is not a fixed multiple of the median: as a service saturates,
 * its p95 and p99 blow out much faster than its p50. Deriving the percentiles
 * from load rather than hard-coding them is what makes the API monitor
 * believable during an incident.
 */
export function derivePercentiles(snapshot: MetricSnapshot, def: ServiceDef): MetricSnapshot {
  const median = snapshot.latencyMs ?? 0;
  const cpu = snapshot.cpu ?? 0;
  const errorRate = snapshot.errorRate ?? 0;
  // Saturation pressure: 0 when idle, grows sharply past ~70% CPU.
  const pressure = clamp((cpu - 60) / 40, 0, 1) + clamp(errorRate * 6, 0, 1);
  const p95 = median * (2.1 + pressure * 2.4);
  const p99 = median * (3.4 + pressure * 6.2);
  return {
    ...snapshot,
    latencyP95: p95,
    latencyP99: p99,
    // Keep the slo on the def in play so unused params stay meaningful.
    ...(def.slo.latencyMs > 0 ? {} : {}),
  };
}

const RANK: Record<HealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  critical: 2,
  offline: 3,
};

const BY_RANK: HealthStatus[] = ["healthy", "degraded", "critical", "offline"];

export function worseOf(a: HealthStatus, b: HealthStatus): HealthStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

export function statusRank(status: HealthStatus): number {
  return RANK[status];
}

/**
 * A service's own health, judged against its SLO. Returns a reason string so
 * the UI can always explain *why* something is red rather than just colouring
 * it — which is the difference between a dashboard and a diagnostic tool.
 */
export function deriveOwnStatus(
  def: ServiceDef,
  metrics: MetricSnapshot,
  reachable: boolean,
): { status: HealthStatus; reason: string | null } {
  if (!reachable) {
    return { status: "offline", reason: "Host unreachable — no response to health probes" };
  }

  const latency = metrics.latencyMs ?? 0;
  const errorRate = metrics.errorRate ?? 0;
  const cpu = metrics.cpu ?? 0;
  const memory = metrics.memory ?? 0;
  const packetLoss = metrics.packetLoss ?? 0;
  const connections = metrics.connections;
  const limit = def.baseline.connectionLimit;

  const criticalReasons: string[] = [];
  const degradedReasons: string[] = [];

  if (errorRate >= def.slo.errorRate * 5) {
    criticalReasons.push(`error rate ${(errorRate * 100).toFixed(1)}% far above SLO`);
  } else if (errorRate >= def.slo.errorRate) {
    degradedReasons.push(`error rate ${(errorRate * 100).toFixed(2)}% above SLO`);
  }

  if (latency >= def.slo.latencyMs * 2.5) {
    criticalReasons.push(`latency ${Math.round(latency)}ms far above SLO`);
  } else if (latency >= def.slo.latencyMs) {
    degradedReasons.push(`latency ${Math.round(latency)}ms above SLO`);
  }

  if (cpu >= 96) criticalReasons.push(`CPU saturated at ${Math.round(cpu)}%`);
  else if (cpu >= 87) degradedReasons.push(`CPU elevated at ${Math.round(cpu)}%`);

  if (memory >= 95) criticalReasons.push(`memory at ${Math.round(memory)}%`);
  else if (memory >= 86) degradedReasons.push(`memory elevated at ${Math.round(memory)}%`);

  if (packetLoss >= 0.08) criticalReasons.push(`${(packetLoss * 100).toFixed(1)}% packet loss`);
  else if (packetLoss >= 0.02) degradedReasons.push(`${(packetLoss * 100).toFixed(1)}% packet loss`);

  if (connections !== undefined && limit !== undefined) {
    const usage = connections / limit;
    if (usage >= 0.97) criticalReasons.push(`connection pool exhausted (${connections}/${limit})`);
    else if (usage >= 0.85) degradedReasons.push(`connection pool at ${Math.round(usage * 100)}%`);
  }

  if (criticalReasons.length > 0) {
    return { status: "critical", reason: capitalise(criticalReasons.join("; ")) };
  }
  if (degradedReasons.length > 0) {
    return { status: "degraded", reason: capitalise(degradedReasons.join("; ")) };
  }
  return { status: "healthy", reason: null };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Cascade health along the dependency graph, attenuating by one level per hop.
 *
 * A dependency being *offline* makes its callers critical; a *critical*
 * dependency makes its callers degraded; beyond that the blast radius fades.
 * Soft dependencies (a cache, a queue) only ever degrade their callers, because
 * losing a cache makes you slow, not dead. This single rule is what produces a
 * believable failure radius without every scenario having to enumerate it.
 */
export function propagateHealth(
  runtimes: Record<ServiceId, ServiceRuntime>,
): Record<ServiceId, ServiceRuntime> {
  const next = { ...runtimes };

  for (const id of TOPO_ORDER) {
    const def = getService(id);
    const current = next[id];
    if (!current || current.status === "offline") continue;

    let derived: HealthStatus = current.status;
    let reason = current.reason;

    for (const depId of def.dependencies) {
      const dep = next[depId];
      if (!dep) continue;
      const depRank = RANK[dep.status];
      if (depRank < 2) continue;
      const cascaded = BY_RANK[Math.max(0, depRank - 1)];
      if (RANK[cascaded] > RANK[derived]) {
        derived = cascaded;
        reason = `Upstream dependency ${serviceName(depId)} is ${dep.status}`;
      }
    }

    for (const depId of def.softDependencies ?? []) {
      const dep = next[depId];
      if (!dep) continue;
      if (RANK[dep.status] >= 3 && RANK.degraded > RANK[derived]) {
        derived = "degraded";
        reason = `Falling back — ${serviceName(depId)} is unavailable`;
      }
    }

    if (derived !== current.status) {
      next[id] = { ...current, status: derived, reason };
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Fleet aggregates
// ---------------------------------------------------------------------------

export interface FleetSummary {
  status: "operational" | "degraded" | "major-incident";
  servicesOnline: number;
  servicesTotal: number;
  degradedCount: number;
  criticalCount: number;
  avgLatency: number;
  errorRate: number;
  totalRps: number;
  availability: number;
}

/** Roll the fleet up into the numbers shown on the Overview hero. */
export function summariseFleet(runtimes: Record<ServiceId, ServiceRuntime>): FleetSummary {
  const all = SERVICES.map((s) => runtimes[s.id]).filter(Boolean);
  const customerFacing = SERVICES.filter((s) => s.customerFacing).map((s) => runtimes[s.id]);

  const degradedCount = all.filter((r) => r.status === "degraded").length;
  const criticalCount = all.filter((r) => r.status === "critical" || r.status === "offline").length;
  const servicesOnline = all.filter((r) => r.status !== "offline").length;

  // Latency and error rate are weighted by traffic, so a quiet back-office
  // service cannot drag the headline number around.
  let weightedLatency = 0;
  let weightedErrors = 0;
  let totalRps = 0;
  for (const svc of SERVICES) {
    const rt = runtimes[svc.id];
    if (!rt || !svc.customerFacing) continue;
    const rps = rt.metrics.rps ?? 0;
    weightedLatency += (rt.metrics.latencyMs ?? 0) * rps;
    weightedErrors += (rt.metrics.errorRate ?? 0) * rps;
    totalRps += rps;
  }

  const customerCritical = customerFacing.filter(
    (r) => r?.status === "critical" || r?.status === "offline",
  ).length;

  const status: FleetSummary["status"] =
    customerCritical > 0 ? "major-incident" : degradedCount > 0 || criticalCount > 0 ? "degraded" : "operational";

  const totalSeconds = all.reduce((sum, r) => sum + r.uptimeSeconds, 0);
  const downSeconds = all.reduce((sum, r) => sum + r.downtimeSeconds, 0);

  return {
    status,
    servicesOnline,
    servicesTotal: SERVICES.length,
    degradedCount,
    criticalCount,
    avgLatency: totalRps > 0 ? weightedLatency / totalRps : 0,
    errorRate: totalRps > 0 ? weightedErrors / totalRps : 0,
    totalRps,
    availability: totalSeconds > 0 ? 1 - downSeconds / totalSeconds : 1,
  };
}

/** Metric channels that make sense to chart for a given service. */
export function chartableMetrics(def: ServiceDef): MetricKey[] {
  return def.metrics.filter((m) => m !== "latencyP95" && m !== "latencyP99");
}
