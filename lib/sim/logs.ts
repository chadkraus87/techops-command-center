import { hexId, noiseAt, pickWeighted, requestId } from "./random";
import { getService, SERVICES } from "./services";
import type {
  LogEntry,
  LogFieldValue,
  LogLevel,
  ScenarioLogTemplate,
  ServiceId,
} from "./types";

/**
 * Log generation.
 *
 * Two sources feed the stream: steady baseline chatter that every service emits
 * when healthy, and scenario templates that only appear while an incident is
 * running. Both are deterministic — the same tick produces the same line — and
 * both go through the same token substitution so structured fields stay
 * consistent between them.
 */

export const MAX_LOG_ENTRIES = 600;

interface BaselineTemplate {
  service: ServiceId;
  level: LogLevel;
  message: string;
  weight: number;
  fields?: Record<string, LogFieldValue>;
}

/** Ordinary production noise. Mostly INFO, occasionally a benign warning. */
const BASELINE_TEMPLATES: BaselineTemplate[] = [
  {
    service: "api-gateway",
    level: "INFO",
    message: "GET /api/projects 200 in {ms}ms",
    weight: 14,
    fields: { statusCode: 200, method: "GET" },
  },
  {
    service: "api-gateway",
    level: "INFO",
    message: "GET /api/users 200 in {ms}ms",
    weight: 12,
    fields: { statusCode: 200, method: "GET" },
  },
  {
    service: "api-gateway",
    level: "DEBUG",
    message: "rate limit check passed for tenant tnt_{id} ({n}/1000)",
    weight: 5,
  },
  {
    service: "customer-api",
    level: "INFO",
    message: "query completed in {ms}ms — 42 rows",
    weight: 10,
    fields: { rows: 42 },
  },
  {
    service: "customer-api",
    level: "DEBUG",
    message: "cache hit for key projects:tnt_{id}:page:1",
    weight: 6,
  },
  {
    service: "identity-service",
    level: "INFO",
    message: "session issued for usr_{id} (ttl 3600s)",
    weight: 9,
    fields: { ttl: 3600 },
  },
  {
    service: "identity-service",
    level: "WARN",
    message: "failed login attempt for usr_{id} — invalid password (attempt 1 of 5)",
    weight: 2,
  },
  {
    service: "media-service",
    level: "INFO",
    message: "transcode complete med_{id} → webp in {ms}ms",
    weight: 8,
  },
  {
    service: "media-service",
    level: "DEBUG",
    message: "thumbnail cache warm — {n} objects resident",
    weight: 4,
  },
  {
    service: "payment-service",
    level: "INFO",
    message: "charge pay_{id} succeeded ({n} cents)",
    weight: 5,
  },
  {
    service: "primary-db",
    level: "INFO",
    message: "checkpoint complete: wrote {n} buffers in 2.1s",
    weight: 4,
  },
  {
    service: "primary-db",
    level: "DEBUG",
    message: "autovacuum: table usage_events, {n} dead tuples removed",
    weight: 3,
  },
  {
    service: "redis-cache",
    level: "DEBUG",
    message: "keyspace hit ratio {n}% over last 60s",
    weight: 4,
  },
  {
    service: "edge-cdn",
    level: "INFO",
    message: "HIT /assets/app.{id}.js from PoP iad-07 in {ms}ms",
    weight: 10,
    fields: { pop: "iad-07", cache: "HIT" },
  },
  {
    service: "edge-cdn",
    level: "DEBUG",
    message: "MISS /assets/thumb/{id}.webp — fetching from origin",
    weight: 4,
    fields: { cache: "MISS" },
  },
  {
    service: "load-balancer",
    level: "INFO",
    message: "upstream web-frontend selected (least_request, {n} active)",
    weight: 7,
  },
  {
    service: "dns-resolver",
    level: "DEBUG",
    message: "resolved customer-api.internal.meridian.io → 10.20.12.60 in {ms}ms",
    weight: 8,
  },
  {
    service: "message-queue",
    level: "DEBUG",
    message: "published event.usage.recorded to exchange meridian.events",
    weight: 6,
  },
  {
    service: "notification-worker",
    level: "INFO",
    message: "delivered email notification ntf_{id} to queue",
    weight: 5,
  },
  {
    service: "internal-api",
    level: "INFO",
    message: "support console query completed in {ms}ms",
    weight: 4,
  },
  {
    service: "analytics-pipeline",
    level: "INFO",
    message: "batch window closed — {n} events aggregated",
    weight: 4,
  },
  {
    service: "web-frontend",
    level: "INFO",
    message: "rendered /dashboard in {ms}ms (ssr)",
    weight: 9,
  },
  {
    service: "analytics-pipeline",
    level: "WARN",
    message: "late-arriving event discarded (watermark exceeded by 42s)",
    weight: 2,
  },
];

/** Replace the tokens shared by baseline and scenario templates. */
export function renderMessage(
  template: string,
  seed: string,
  tick: number,
  latencyMs: number,
): string {
  return template
    .replace(/\{ms\}/g, String(Math.max(1, Math.round(latencyMs * (0.6 + noiseAt(`${seed}:ms`, tick) * 0.9)))))
    .replace(/\{id\}/g, hexId(`${seed}:id`, tick, 6))
    .replace(/\{n\}/g, String(Math.round(20 + noiseAt(`${seed}:n`, tick) * 9800)));
}

let logCounter = 0;

function makeEntry(
  service: ServiceId,
  level: LogLevel,
  message: string,
  clock: number,
  seed: string,
  tick: number,
  fields?: Record<string, LogFieldValue>,
  incidentId?: string,
): LogEntry {
  const def = getService(service);
  return {
    id: `log-${clock}-${logCounter++}`,
    timestamp: clock,
    level,
    service,
    message,
    requestId: requestId(seed, tick),
    host: def.hostname,
    environment: "production",
    incidentId,
    fields,
  };
}

/**
 * How many lines the fleet emits this tick. Busier and sicker systems talk more,
 * which is realistic and also makes an incident feel immediately different.
 */
export function logVolumeForTick(intensity: number, tick: number): number {
  const base = 2 + Math.floor(noiseAt("log:volume", tick) * 2);
  const incidentBoost = Math.round(intensity * 6);
  return base + incidentBoost;
}

export interface LogGenerationInput {
  tick: number;
  clock: number;
  /** 0..1 — how far into an incident we are. 0 means healthy. */
  intensity: number;
  scenarioTemplates: ScenarioLogTemplate[];
  incidentId?: string;
  /** Current latency per service, used to make timings in messages truthful. */
  latencyByService: Partial<Record<ServiceId, number>>;
}

/** Produce this tick's log lines. Pure and deterministic. */
export function generateLogs(input: LogGenerationInput): LogEntry[] {
  const { tick, clock, intensity, scenarioTemplates, incidentId, latencyByService } = input;
  const count = logVolumeForTick(intensity, tick);
  const entries: LogEntry[] = [];

  const eligibleScenario = scenarioTemplates.filter(
    (t) => intensity >= (t.minIntensity ?? 0.05),
  );

  for (let i = 0; i < count; i++) {
    const seed = `log:${tick}:${i}`;
    // The sicker the system, the more of the stream is incident-related.
    const useScenario =
      eligibleScenario.length > 0 && noiseAt(`${seed}:src`, tick) < Math.min(0.85, intensity * 1.15);

    if (useScenario) {
      const template = pickWeighted(eligibleScenario, `${seed}:pick`, tick);
      if (!template) continue;
      const latency = latencyByService[template.service] ?? 100;
      entries.push(
        makeEntry(
          template.service,
          template.level,
          renderMessage(template.message, seed, tick, latency),
          clock,
          seed,
          tick,
          template.fields,
          incidentId,
        ),
      );
    } else {
      const template = pickWeighted(BASELINE_TEMPLATES, `${seed}:pick`, tick);
      if (!template) continue;
      const latency = latencyByService[template.service] ?? 100;
      entries.push(
        makeEntry(
          template.service,
          template.level,
          renderMessage(template.message, seed, tick, latency),
          clock,
          seed,
          tick,
          template.fields,
        ),
      );
    }
  }

  return entries;
}

/**
 * Seed the explorer with history so it never opens empty. Generates a healthy
 * backlog ending at the current clock.
 */
export function seedLogHistory(clock: number, count = 120): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = count; i > 0; i--) {
    const tick = -i;
    const seed = `seed:${i}`;
    const template = pickWeighted(BASELINE_TEMPLATES, seed, tick);
    if (!template) continue;
    const def = getService(template.service);
    entries.push(
      makeEntry(
        template.service,
        template.level,
        renderMessage(template.message, seed, tick, def.baseline.latencyMs),
        clock - i * 900,
        seed,
        tick,
        template.fields,
      ),
    );
  }
  return entries;
}

export const LOG_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"];

export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

export const LOG_SERVICES = SERVICES.map((s) => ({ id: s.id, name: s.name }));
