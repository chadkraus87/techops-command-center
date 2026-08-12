import type { Deployment, FeatureFlag, KnownBug } from "./types";

/**
 * Release engineering fixtures for the QA Lab.
 *
 * The deployment history matters operationally, not just decoratively: "what
 * shipped just before this started?" is one of the first questions in any real
 * investigation, and several scenarios are designed to be solved (or ruled out)
 * by checking it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function seedDeployments(clock: number): Deployment[] {
  return [
    {
      id: "dep-2041",
      service: "media-service",
      version: "3.14.1",
      deployedAt: clock - 3 * HOUR,
      status: "succeeded",
      author: "Marcus Webb",
      testsPassed: 218,
      testsFailed: 0,
      coverage: 87.4,
      regressionRisk: "low",
      changelog: [
        "Fix EXIF orientation on portrait thumbnails",
        "Reduce transcode queue polling interval",
      ],
    },
    {
      id: "dep-2040",
      service: "customer-api",
      version: "6.4.1",
      deployedAt: clock - 7 * HOUR,
      status: "succeeded",
      author: "Dana Whitfield",
      testsPassed: 412,
      testsFailed: 0,
      coverage: 91.2,
      regressionRisk: "low",
      changelog: ["Add cursor pagination to /api/projects", "Tighten tenant scoping on usage rollups"],
    },
    {
      id: "dep-2039",
      service: "identity-service",
      version: "3.9.2",
      deployedAt: clock - 26 * HOUR,
      status: "succeeded",
      author: "Sam Okonkwo",
      testsPassed: 305,
      testsFailed: 0,
      coverage: 94.1,
      regressionRisk: "low",
      changelog: ["Rotate signing key material", "Shorten refresh-token grace window"],
    },
    {
      id: "dep-2038",
      service: "api-gateway",
      version: "5.1.0",
      deployedAt: clock - 31 * HOUR,
      status: "succeeded",
      author: "Dana Whitfield",
      testsPassed: 388,
      testsFailed: 0,
      coverage: 89.7,
      regressionRisk: "medium",
      changelog: [
        "Per-tenant rate limiting with Redis counters",
        "Circuit breaker on slow upstreams",
        "Structured access logging",
      ],
    },
    {
      id: "dep-2037",
      service: "payment-service",
      version: "2.7.8",
      deployedAt: clock - 9 * 24 * HOUR,
      status: "succeeded",
      author: "Elena Vasquez",
      testsPassed: 176,
      testsFailed: 0,
      coverage: 93.8,
      regressionRisk: "low",
      changelog: ["Idempotency keys on retry path", "Upgrade provider SDK to 4.2.0"],
    },
    {
      id: "dep-2036",
      service: "web-frontend",
      version: "7.2.3",
      deployedAt: clock - 2 * 24 * HOUR,
      status: "rolled-back",
      author: "Dana Whitfield",
      testsPassed: 502,
      testsFailed: 3,
      coverage: 84.1,
      regressionRisk: "high",
      changelog: [
        "New dashboard layout experiment",
        "Rolled back after 12 minutes — layout shift regression on tablet breakpoints",
      ],
    },
  ];
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: "new-thumbnail-pipeline",
    description: "Routes image transcoding through the rewritten buffer pool.",
    enabled: true,
    rollout: 100,
    owner: "Marcus Webb",
  },
  {
    key: "gateway-circuit-breaker",
    description: "Opens a circuit on upstreams exceeding the p99 latency budget.",
    enabled: true,
    rollout: 100,
    owner: "Dana Whitfield",
  },
  {
    key: "read-replica-routing",
    description: "Sends analytical reads to the streaming replica instead of the primary.",
    enabled: false,
    rollout: 0,
    owner: "Priya Raman",
  },
  {
    key: "checkout-v2",
    description: "Redesigned checkout flow with the secondary provider as fallback.",
    enabled: true,
    rollout: 35,
    owner: "Elena Vasquez",
  },
  {
    key: "session-cache-writeback",
    description: "Writes session updates to cache first, database asynchronously.",
    enabled: true,
    rollout: 100,
    owner: "Sam Okonkwo",
  },
  {
    key: "edge-brotli",
    description: "Brotli compression at the edge for text assets.",
    enabled: true,
    rollout: 100,
    owner: "Marcus Webb",
  },
];

export function seedKnownBugs(clock: number): KnownBug[] {
  return [
    {
      id: "BUG-3312",
      title: "Transcode queue depth metric double-counts retried jobs",
      severity: "P3",
      service: "media-service",
      status: "open",
      reportedAt: clock - 4 * 24 * HOUR,
    },
    {
      id: "BUG-3309",
      title: "Rate-limit headers missing on 429 responses",
      severity: "P2",
      service: "api-gateway",
      status: "in-progress",
      reportedAt: clock - 6 * 24 * HOUR,
    },
    {
      id: "BUG-3301",
      title: "Session refresh races when two tabs refresh simultaneously",
      severity: "P2",
      service: "identity-service",
      status: "open",
      reportedAt: clock - 11 * 24 * HOUR,
    },
    {
      id: "BUG-3298",
      title: "Usage export omits the final partial hour",
      severity: "P3",
      service: "customer-api",
      status: "fixed",
      reportedAt: clock - 14 * 24 * HOUR,
    },
    {
      id: "BUG-3287",
      title: "Connection pool metrics not exported during failover",
      severity: "P1",
      service: "primary-db",
      status: "in-progress",
      reportedAt: clock - 18 * 24 * HOUR,
    },
  ];
}

export interface TestSuite {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  durationSeconds: number;
  kind: "unit" | "integration" | "e2e" | "load";
}

export const TEST_SUITES: TestSuite[] = [
  { name: "Unit — core domain", passed: 1284, failed: 0, skipped: 12, durationSeconds: 34, kind: "unit" },
  { name: "Integration — API contract", passed: 412, failed: 0, skipped: 4, durationSeconds: 128, kind: "integration" },
  { name: "Integration — data layer", passed: 268, failed: 0, skipped: 2, durationSeconds: 96, kind: "integration" },
  { name: "End-to-end — critical paths", passed: 86, failed: 2, skipped: 0, durationSeconds: 412, kind: "e2e" },
  { name: "Load — sustained 2k rps", passed: 18, failed: 0, skipped: 0, durationSeconds: 900, kind: "load" },
];

export const ENVIRONMENTS = [
  { name: "production", status: "healthy" as const, version: "5.1.0", region: "us-east-1, eu-west-1" },
  { name: "staging", status: "healthy" as const, version: "5.2.0-rc.3", region: "us-east-1" },
  { name: "preview", status: "degraded" as const, version: "5.2.0-rc.4", region: "us-east-1" },
  { name: "development", status: "healthy" as const, version: "5.2.0-dev", region: "local" },
];
