import { SERVICES, serviceName } from "./services";
import type {
  Alert,
  AlertRule,
  MetricKey,
  ServiceId,
  ServiceRuntime,
  SimState,
} from "./types";

/**
 * Alerting.
 *
 * Rules are generated from each service's own SLO rather than hand-written, so
 * the alert set stays consistent with the health model and a new service is
 * covered the moment it is added to the catalogue. Every rule has a `forSeconds`
 * window — alerts only fire once a condition has *held*, which is what stops the
 * alert list flapping on a single noisy sample.
 */

function rule(
  id: string,
  service: ServiceId,
  metric: MetricKey,
  comparator: "gt" | "lt",
  threshold: number,
  severity: AlertRule["severity"],
  title: string,
  forSeconds: number,
): AlertRule {
  return { id, service, metric, comparator, threshold, severity, title, forSeconds };
}

export const ALERT_RULES: AlertRule[] = SERVICES.flatMap((svc) => {
  const rules: AlertRule[] = [
    rule(
      `${svc.id}:error-critical`,
      svc.id,
      "errorRate",
      "gt",
      svc.slo.errorRate * 4,
      "critical",
      `${svc.name} error rate critically high`,
      20,
    ),
    rule(
      `${svc.id}:error-warning`,
      svc.id,
      "errorRate",
      "gt",
      svc.slo.errorRate,
      "warning",
      `${svc.name} error rate above SLO`,
      30,
    ),
    rule(
      `${svc.id}:latency-critical`,
      svc.id,
      "latencyMs",
      "gt",
      svc.slo.latencyMs * 2.5,
      "critical",
      `${svc.name} latency critically high`,
      25,
    ),
    rule(
      `${svc.id}:latency-warning`,
      svc.id,
      "latencyMs",
      "gt",
      svc.slo.latencyMs,
      "warning",
      `${svc.name} latency above SLO`,
      40,
    ),
    rule(`${svc.id}:cpu`, svc.id, "cpu", "gt", 90, "warning", `${svc.name} CPU saturation`, 45),
    rule(`${svc.id}:memory`, svc.id, "memory", "gt", 90, "warning", `${svc.name} memory pressure`, 45),
    rule(
      `${svc.id}:packet-loss`,
      svc.id,
      "packetLoss",
      "gt",
      0.03,
      "warning",
      `${svc.name} packet loss detected`,
      30,
    ),
  ];

  if (svc.baseline.connections !== undefined && svc.baseline.connectionLimit !== undefined) {
    const limit = svc.baseline.connectionLimit;
    rules.push(
      rule(
        `${svc.id}:connections-critical`,
        svc.id,
        "connections",
        "gt",
        limit * 0.95,
        "critical",
        `${svc.name} connection pool exhausted`,
        15,
      ),
      rule(
        `${svc.id}:connections-warning`,
        svc.id,
        "connections",
        "gt",
        limit * 0.85,
        "warning",
        `${svc.name} connection pool above 85%`,
        30,
      ),
    );
  }

  if (svc.baseline.cacheHitRate !== undefined) {
    rules.push(
      rule(
        `${svc.id}:cache-hit`,
        svc.id,
        "cacheHitRate",
        "lt",
        0.6,
        "warning",
        `${svc.name} cache hit rate collapsed`,
        25,
      ),
    );
  }

  if (svc.baseline.queueDepth !== undefined) {
    rules.push(
      rule(
        `${svc.id}:queue-depth`,
        svc.id,
        "queueDepth",
        "gt",
        svc.baseline.queueDepth * 3,
        "warning",
        `${svc.name} queue depth growing`,
        40,
      ),
    );
  }

  return rules;
});

const RULE_MAP = new Map(ALERT_RULES.map((r) => [r.id, r]));

function formatValue(metric: MetricKey, value: number): string {
  switch (metric) {
    case "errorRate":
    case "packetLoss":
      return `${(value * 100).toFixed(2)}%`;
    case "cacheHitRate":
      return `${(value * 100).toFixed(1)}%`;
    case "latencyMs":
      return `${Math.round(value)}ms`;
    case "cpu":
    case "memory":
    case "diskUsage":
      return `${Math.round(value)}%`;
    default:
      return Math.round(value).toLocaleString();
  }
}

export function alertDetail(rule: AlertRule, value: number): string {
  const direction = rule.comparator === "gt" ? "above" : "below";
  return `${formatValue(rule.metric, value)} ${direction} threshold of ${formatValue(
    rule.metric,
    rule.threshold,
  )} on ${serviceName(rule.service)}`;
}

function breached(rule: AlertRule, value: number | undefined): boolean {
  if (value === undefined || Number.isNaN(value)) return false;
  return rule.comparator === "gt" ? value > rule.threshold : value < rule.threshold;
}

/**
 * A rule is suppressed when a more severe rule on the same service and metric is
 * already firing. Without this, one problem produces two alerts (warning *and*
 * critical) for the same signal and the alert list becomes noise.
 */
function isSuppressed(rule: AlertRule, firingIds: Set<string>): boolean {
  if (rule.severity !== "warning") return false;
  const criticalTwin = `${rule.service}:${
    rule.metric === "errorRate" ? "error" : rule.metric === "latencyMs" ? "latency" : "connections"
  }-critical`;
  return firingIds.has(criticalTwin);
}

export interface AlertEvaluation {
  alerts: Alert[];
  holds: Record<string, number>;
  /** Alerts that transitioned from clear to firing on this tick. */
  fired: Alert[];
  /** Alerts that cleared on this tick. */
  cleared: Alert[];
}

/**
 * Evaluate every rule for one tick.
 *
 * Pure: given the same runtimes and hold state it always produces the same
 * result, which is what makes alerting testable.
 */
export function evaluateAlerts(
  runtimes: Record<ServiceId, ServiceRuntime>,
  existing: Alert[],
  holds: Record<string, number>,
  clock: number,
  dtSeconds: number,
  incidentId?: string,
): AlertEvaluation {
  const nextHolds: Record<string, number> = { ...holds };
  const byRule = new Map(existing.filter((a) => a.resolvedAt === null).map((a) => [a.ruleId, a]));

  // First pass: which conditions are currently true and have held long enough.
  const readyToFire = new Set<string>();
  for (const rule of ALERT_RULES) {
    const runtime = runtimes[rule.service];
    const value = runtime?.metrics[rule.metric];
    if (breached(rule, value)) {
      nextHolds[rule.id] = (nextHolds[rule.id] ?? 0) + dtSeconds;
      if (nextHolds[rule.id] >= rule.forSeconds) readyToFire.add(rule.id);
    } else {
      nextHolds[rule.id] = 0;
    }
  }

  const fired: Alert[] = [];
  const cleared: Alert[] = [];
  const next: Alert[] = existing.filter((a) => a.resolvedAt !== null);

  for (const rule of ALERT_RULES) {
    const active = byRule.get(rule.id);
    const shouldFire = readyToFire.has(rule.id) && !isSuppressed(rule, readyToFire);
    const value = runtimes[rule.service]?.metrics[rule.metric] ?? 0;

    if (shouldFire) {
      if (active) {
        // Keep the alert but refresh the observed value so the detail stays live.
        next.push({ ...active, value, detail: alertDetail(rule, value) });
      } else {
        const alert: Alert = {
          id: `alert-${rule.id}-${clock}`,
          ruleId: rule.id,
          service: rule.service,
          severity: rule.severity,
          title: rule.title,
          detail: alertDetail(rule, value),
          metric: rule.metric,
          value,
          threshold: rule.threshold,
          firedAt: clock,
          resolvedAt: null,
          acknowledged: false,
          incidentId,
        };
        next.push(alert);
        fired.push(alert);
      }
    } else if (active) {
      const resolved: Alert = { ...active, resolvedAt: clock };
      next.push(resolved);
      cleared.push(resolved);
    }
  }

  return { alerts: next, holds: nextHolds, fired, cleared };
}

export function getRule(id: string): AlertRule | undefined {
  return RULE_MAP.get(id);
}

export function activeAlerts(state: SimState): Alert[] {
  return state.alerts.filter((a) => a.resolvedAt === null);
}

export const ALERT_SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const sev = ALERT_SEVERITY_ORDER[a.severity] - ALERT_SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return b.firedAt - a.firedAt;
  });
}
