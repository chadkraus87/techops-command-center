import type { Scenario } from "../types";

/**
 * Redis Cache Failure.
 *
 * Teaching point: a cache outage is a *load amplifier*. Nothing returns errors
 * at first — every read simply falls through to Postgres, so the database gets
 * hit with several times its normal traffic and becomes the visible victim.
 * The trap is diagnosing the database.
 */
export const redisFailure: Scenario = {
  id: "redis-failure",
  title: "Redis Cache Failure",
  summary:
    "The cache node stops responding. Reads fall through to the database, which suddenly takes five times its normal load.",
  difficulty: "intermediate",
  severity: "SEV-2",
  affectedServices: ["redis-cache", "primary-db", "identity-service", "customer-api", "api-gateway"],
  expectedImpact:
    "Cache hit rate collapses to zero, database read volume multiplies, and session lookups slow across the platform.",
  customerImpact:
    "Sign-in is slow and some sessions are dropped, forcing users to log in again. Pages load but sluggishly.",
  declareAfterSeconds: 50,
  recoverySeconds: 35,

  impacts: [
    { service: "redis-cache", metric: "errorRate", mode: "set", value: 0.97, rampSeconds: 12 },
    { service: "redis-cache", metric: "cacheHitRate", mode: "set", value: 0.0, rampSeconds: 15 },
    { service: "redis-cache", metric: "latencyMs", mode: "multiply", value: 60, rampSeconds: 15 },
    { service: "redis-cache", metric: "rps", mode: "multiply", value: 0.05, delaySeconds: 15, rampSeconds: 20 },

    // The database absorbs everything the cache used to serve.
    { service: "primary-db", metric: "rps", mode: "multiply", value: 4.2, delaySeconds: 10, rampSeconds: 30 },
    { service: "primary-db", metric: "cpu", mode: "set", value: 91, delaySeconds: 10, rampSeconds: 35 },
    { service: "primary-db", metric: "connections", mode: "set", value: 172, delaySeconds: 12, rampSeconds: 35 },
    { service: "primary-db", metric: "latencyMs", mode: "multiply", value: 7, delaySeconds: 15, rampSeconds: 35 },

    { service: "identity-service", metric: "latencyMs", mode: "multiply", value: 12, delaySeconds: 8, rampSeconds: 30 },
    { service: "identity-service", metric: "errorRate", mode: "set", value: 0.09, delaySeconds: 40, rampSeconds: 35 },
    { service: "customer-api", metric: "latencyMs", mode: "multiply", value: 6, delaySeconds: 15, rampSeconds: 35 },
    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 4, delaySeconds: 20, rampSeconds: 35 },
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.06, delaySeconds: 45, rampSeconds: 35 },
  ],

  logTemplates: [
    {
      service: "redis-cache",
      level: "CRITICAL",
      message: "connection refused on 10.20.30.11:6379 — node not accepting clients",
      weight: 9,
      fields: { port: 6379, errno: "ECONNREFUSED" },
    },
    {
      service: "redis-cache",
      level: "ERROR",
      message: "MISCONF Redis is configured to save RDB snapshots but is currently unable to persist",
      weight: 5,
    },
    {
      service: "identity-service",
      level: "WARN",
      message: "session cache unavailable — falling back to database lookup ({n}ms)",
      weight: 9,
      fields: { fallback: "primary-db", cache: "redis" },
    },
    {
      service: "customer-api",
      level: "WARN",
      message: "cache miss ratio 100% over last 60s; query volume up 420%",
      weight: 6,
    },
    {
      service: "primary-db",
      level: "WARN",
      message: "read throughput {n} queries/s — sustained above provisioned baseline",
      weight: 6,
      minIntensity: 0.4,
    },
    {
      service: "api-gateway",
      level: "WARN",
      message: "rate-limit counters unavailable; failing open for /api/*",
      weight: 4,
      fields: { policy: "fail-open" },
    },
  ],

  ticketTemplates: [
    {
      subject: "Keep getting logged out",
      body: "I sign in, click around for a minute, and I'm back at the login screen. It's happened four times now.",
      priority: "high",
      affectedService: "identity-service",
      suggestedSteps: ["Check session store availability", "Confirm whether sessions are being written at all"],
    },
    {
      subject: "Everything is slower than usual",
      body: "The app works but every page takes several seconds longer than normal.",
      priority: "normal",
      affectedService: "customer-api",
      suggestedSteps: ["Compare cache hit rate against database read volume"],
    },
    {
      subject: "Login takes 10+ seconds",
      body: "Signing in used to be instant. Now it hangs for ages before letting me through.",
      priority: "high",
      affectedService: "identity-service",
      suggestedSteps: ["Trace the auth path and identify which hop added the latency"],
    },
  ],

  diagnosisOptions: [
    { id: "cache-failure", label: "Cache layer failure", feedback: "" },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "The database really is under strain — but ask why. Its request volume has quadrupled with no increase in user traffic. Something that used to absorb those reads has stopped doing so.",
    },
    {
      id: "auth-failure",
      label: "Authentication service failure",
      feedback:
        "Identity is the loudest symptom because it is the most cache-dependent service. Its own CPU and memory are fine — it is waiting on something else.",
    },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback: "Lookups are resolving normally. Requests are arriving; they are just slow.",
    },
    {
      id: "traffic-spike",
      label: "Organic traffic spike",
      feedback:
        "Check inbound request rate at the edge — it is flat. The extra load is being generated internally, not by users.",
    },
  ],
  correctDiagnosisId: "cache-failure",

  remediationOptions: [
    {
      id: "restart-redis",
      label: "Restart Redis and restore persistence",
      description: "Bring the cache node back with its snapshot and re-enable persistence.",
      durationSeconds: 20,
      ineffectiveNote: "",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections to admit the extra query load.",
      durationSeconds: 15,
      ineffectiveNote:
        "This let more queries through but the database is CPU-bound, not connection-bound. Latency barely moved.",
    },
    {
      id: "restart-identity",
      label: "Restart Identity Service",
      description: "Rolling restart of the auth deployment.",
      durationSeconds: 18,
      ineffectiveNote: "Identity restarted healthy and immediately failed to reach the cache again.",
    },
    {
      id: "scale-customer-api",
      label: "Scale up Customer API",
      description: "Add replicas to handle the slow requests.",
      durationSeconds: 22,
      ineffectiveNote: "More replicas issued more uncached queries, pushing database CPU higher.",
    },
    {
      id: "purge-cdn-cache",
      label: "Purge CDN cache",
      description: "Invalidate edge objects.",
      durationSeconds: 20,
      ineffectiveNote: "The edge cache is unrelated to the internal session cache. No effect.",
    },
  ],
  requiredRemediationIds: ["restart-redis"],

  rootCause:
    "The Redis node exhausted its disk allocation while writing an RDB snapshot, entered MISCONF state and stopped accepting writes, then stopped accepting connections entirely. Every session lookup and rate-limit check fell through to Postgres, multiplying database read volume by roughly four and pushing the primary to 91% CPU.",
  resolution:
    "Redis was restarted with disk space reclaimed and persistence restored. Hit rate recovered as the working set warmed, database load fell back to baseline, and session latency normalised. Follow-up: alert on cache hit rate, not just cache availability.",

  keyEvidence: [
    "Cache hit rate fell to 0% — the single clearest signal",
    "Database request volume rose ~4x with no increase in user traffic at the edge",
    "Redis logs show MISCONF and then connection refused on 6379",
    "Identity latency rose first because it is the most cache-dependent service",
  ],
};
