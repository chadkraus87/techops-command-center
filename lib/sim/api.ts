import { hexId, noiseAt } from "./random";
import { API_ENDPOINTS, NETWORK_REGIONS } from "./services";
import type {
  ApiEndpointDef,
  ApiEndpointRuntime,
  ApiRequestSample,
  HealthStatus,
  SimState,
} from "./types";

/**
 * API monitoring.
 *
 * Endpoint statistics are derived from the health of the service that actually
 * serves the route, so the API monitor cannot disagree with the rest of the
 * product. If Customer API is degraded, every endpoint routed to it degrades —
 * and the endpoints served by healthy services stay green, which is exactly the
 * comparison that narrows an investigation.
 */

function statusFromMetrics(errorRate: number, latency: number, sloLatency: number): HealthStatus {
  if (errorRate > 0.5) return "critical";
  if (errorRate > 0.05 || latency > sloLatency * 2.5) return "critical";
  if (errorRate > 0.01 || latency > sloLatency) return "degraded";
  return "healthy";
}

/** Current statistics for one endpoint. */
export function endpointRuntime(
  endpoint: ApiEndpointDef,
  state: SimState,
): ApiEndpointRuntime {
  const service = state.services[endpoint.service];
  const gateway = state.services["api-gateway"];
  const metrics = service?.metrics ?? {};

  // Traffic share is of total gateway throughput, so the numbers add up.
  const gatewayRps = gateway?.metrics.rps ?? 0;
  const requestsPerMin = Math.round(gatewayRps * endpoint.trafficShare * 60);

  const p50 = metrics.latencyMs ?? 0;
  const p95 = metrics.latencyP95 ?? p50 * 2.2;
  const p99 = metrics.latencyP99 ?? p50 * 3.6;
  const errorRate = metrics.errorRate ?? 0;

  // A write endpoint fails a little more readily than a read under stress.
  const writeMultiplier = endpoint.method === "POST" ? 1.25 : 1;
  const adjustedError = Math.min(1, errorRate * writeMultiplier);

  return {
    id: endpoint.id,
    requestsPerMin,
    p50,
    p95,
    p99,
    errorRate: adjustedError,
    status: statusFromMetrics(adjustedError, p50, endpoint.method === "POST" ? 800 : 400),
  };
}

export function allEndpointRuntimes(state: SimState): ApiEndpointRuntime[] {
  return API_ENDPOINTS.map((endpoint) => endpointRuntime(endpoint, state));
}

/** Status code chosen to be consistent with what is actually wrong. */
function statusCodeFor(
  endpoint: ApiEndpointDef,
  state: SimState,
  roll: number,
  errorRate: number,
): number {
  if (roll >= errorRate) return endpoint.method === "POST" ? 201 : 200;

  const service = state.services[endpoint.service];
  const latency = service?.metrics.latencyMs ?? 0;
  const reachable = service?.reachable ?? true;

  // Each failure mode produces the status code it would really produce.
  if (!reachable) return 503;
  if (latency > 5000) return 504;
  if (errorRate > 0.6) return 503;
  if (roll < errorRate * 0.18) return 429;
  return 500;
}

const ERROR_BODIES: Record<number, string> = {
  500: `{"error":"internal_error","message":"An unexpected error occurred","requestId":"%ID%"}`,
  502: `{"error":"bad_gateway","message":"Upstream returned an invalid response","requestId":"%ID%"}`,
  503: `{"error":"service_unavailable","message":"Upstream service is not accepting requests","requestId":"%ID%"}`,
  504: `{"error":"gateway_timeout","message":"Upstream did not respond within 30000ms","requestId":"%ID%"}`,
  429: `{"error":"rate_limited","message":"Too many requests","retryAfter":30,"requestId":"%ID%"}`,
};

/**
 * A window of recent requests for one endpoint. Generated on demand from the
 * current state rather than accumulated, which keeps the store small — the
 * samples are a *view* of the metrics, not extra state to maintain.
 */
export function recentRequests(
  endpoint: ApiEndpointDef,
  state: SimState,
  count = 24,
): ApiRequestSample[] {
  const runtime = endpointRuntime(endpoint, state);
  const samples: ApiRequestSample[] = [];

  for (let i = 0; i < count; i++) {
    const seed = `req:${endpoint.id}:${i}`;
    const roll = noiseAt(seed, state.tickCount);
    const statusCode = statusCodeFor(endpoint, state, roll, runtime.errorRate);
    const isError = statusCode >= 400;

    // Failed requests are either very fast (rejected) or very slow (timed out).
    const spread = noiseAt(`${seed}:d`, state.tickCount);
    const durationMs =
      statusCode === 504
        ? 30000
        : statusCode === 503 || statusCode === 429
          ? runtime.p50 * 0.25 * (0.6 + spread)
          : isError
            ? runtime.p95 * (0.8 + spread * 0.6)
            : runtime.p50 * (0.55 + spread * 1.3);

    const requestId = `req_${hexId(seed, state.tickCount, 16)}`;
    const region = NETWORK_REGIONS[Math.floor(noiseAt(`${seed}:r`, state.tickCount) * NETWORK_REGIONS.length)];

    samples.push({
      id: `${endpoint.id}-${i}`,
      endpointId: endpoint.id,
      timestamp: state.clock - i * 1400,
      statusCode,
      durationMs: Math.max(1, durationMs),
      requestId,
      region: region?.id ?? "us-east-1",
      responseBody: isError
        ? (ERROR_BODIES[statusCode] ?? ERROR_BODIES[500]).replace("%ID%", requestId)
        : endpoint.samplePayload,
    });
  }

  return samples;
}

export function statusCodeTone(code: number): "ok" | "warn" | "crit" {
  if (code < 300) return "ok";
  if (code < 500) return "warn";
  return "crit";
}

/** Roll-up shown at the top of the API monitor. */
export function apiSummary(state: SimState) {
  const runtimes = allEndpointRuntimes(state);
  const totalRpm = runtimes.reduce((sum, r) => sum + r.requestsPerMin, 0);
  const weightedError =
    totalRpm > 0
      ? runtimes.reduce((sum, r) => sum + r.errorRate * r.requestsPerMin, 0) / totalRpm
      : 0;
  const worstP99 = runtimes.reduce((max, r) => Math.max(max, r.p99), 0);
  const failing = runtimes.filter((r) => r.status === "critical").length;
  const degraded = runtimes.filter((r) => r.status === "degraded").length;

  return {
    totalRpm,
    successRate: 1 - weightedError,
    worstP99,
    failing,
    degraded,
    healthy: runtimes.length - failing - degraded,
  };
}

export { API_ENDPOINTS };
