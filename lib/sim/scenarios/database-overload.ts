import type { Scenario } from "../types";

/**
 * Database Connection Exhaustion.
 *
 * The teaching point: the symptom surfaces at the API tier (slow requests, 500s)
 * but the cause is two hops down. Every service that touches Postgres degrades
 * together and in proportion to how much it reads; services that don't touch it
 * stay clean. The connection-pool gauge is the smoking gun.
 */
export const databaseOverload: Scenario = {
  id: "database-overload",
  title: "Database Connection Exhaustion",
  summary:
    "An unindexed query starts holding connections open. The pool fills, and everything that needs the database queues behind it.",
  difficulty: "intermediate",
  severity: "SEV-2",
  affectedServices: [
    "primary-db",
    "customer-api",
    "identity-service",
    "api-gateway",
    "payment-service",
    "media-service",
    "web-frontend",
  ],
  expectedImpact:
    "Steadily rising latency across all database-backed endpoints, followed by timeouts and 500s once the pool saturates.",
  customerImpact:
    "The dashboard loads slowly and then begins timing out. Writes fail intermittently; reads served from cache still succeed.",
  declareAfterSeconds: 60,
  recoverySeconds: 55,

  impacts: [
    // The primary: connections climb first, then everything else follows.
    { service: "primary-db", metric: "connections", mode: "set", value: 199, rampSeconds: 50 },
    { service: "primary-db", metric: "latencyMs", mode: "multiply", value: 26, rampSeconds: 60 },
    { service: "primary-db", metric: "cpu", mode: "set", value: 97, rampSeconds: 45 },
    { service: "primary-db", metric: "errorRate", mode: "set", value: 0.14, delaySeconds: 35, rampSeconds: 40 },

    // Read-heavy services feel it first and hardest.
    { service: "customer-api", metric: "latencyMs", mode: "multiply", value: 11, delaySeconds: 15, rampSeconds: 45 },
    { service: "customer-api", metric: "errorRate", mode: "set", value: 0.18, delaySeconds: 45, rampSeconds: 45 },
    { service: "customer-api", metric: "cpu", mode: "add", value: 22, delaySeconds: 20, rampSeconds: 40 },

    { service: "identity-service", metric: "latencyMs", mode: "multiply", value: 8, delaySeconds: 20, rampSeconds: 45 },
    { service: "identity-service", metric: "errorRate", mode: "set", value: 0.12, delaySeconds: 55, rampSeconds: 45 },

    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 6, delaySeconds: 25, rampSeconds: 45 },
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.13, delaySeconds: 50, rampSeconds: 45 },

    { service: "payment-service", metric: "latencyMs", mode: "multiply", value: 5, delaySeconds: 30, rampSeconds: 45 },
    { service: "payment-service", metric: "errorRate", mode: "set", value: 0.1, delaySeconds: 60, rampSeconds: 40 },

    { service: "media-service", metric: "latencyMs", mode: "multiply", value: 3.5, delaySeconds: 35, rampSeconds: 45 },
    { service: "web-frontend", metric: "latencyMs", mode: "multiply", value: 4, delaySeconds: 30, rampSeconds: 45 },
    { service: "web-frontend", metric: "errorRate", mode: "set", value: 0.09, delaySeconds: 60, rampSeconds: 45 },

    // The cache picks up the slack — hit rate rises as reads retry against it.
    { service: "redis-cache", metric: "rps", mode: "multiply", value: 1.6, delaySeconds: 25, rampSeconds: 40 },
    { service: "redis-cache", metric: "cacheHitRate", mode: "set", value: 0.98, delaySeconds: 25, rampSeconds: 40 },

    // Async work backs up behind the same database.
    { service: "message-queue", metric: "queueDepth", mode: "multiply", value: 7, delaySeconds: 45, rampSeconds: 60 },
    { service: "notification-worker", metric: "queueDepth", mode: "multiply", value: 9, delaySeconds: 50, rampSeconds: 60 },
  ],

  logTemplates: [
    {
      service: "primary-db",
      level: "WARN",
      message: "connection pool at {n}% capacity (198/200 in use)",
      weight: 6,
      fields: { poolSize: 200, waiting: 34 },
    },
    {
      service: "primary-db",
      level: "ERROR",
      message: "FATAL: remaining connection slots are reserved for superuser connections",
      weight: 7,
      fields: { sqlstate: "53300" },
    },
    {
      service: "primary-db",
      level: "WARN",
      message:
        'slow query 8420ms: SELECT * FROM usage_events WHERE tenant_id = $1 AND created_at > $2',
      weight: 8,
      fields: { durationMs: 8420, rows: 1840221, plan: "Seq Scan on usage_events" },
    },
    {
      service: "primary-db",
      level: "CRITICAL",
      message: "checkpoint taking longer than expected; WAL write pressure sustained",
      weight: 2,
      minIntensity: 0.7,
    },
    {
      service: "customer-api",
      level: "ERROR",
      message: "database connection timeout after 5000ms",
      weight: 10,
      fields: { pool: "primary", timeoutMs: 5000, acquired: false },
    },
    {
      service: "customer-api",
      level: "ERROR",
      message: "GET /api/projects failed: could not acquire connection from pool",
      weight: 6,
      fields: { statusCode: 500 },
    },
    {
      service: "identity-service",
      level: "ERROR",
      message: "session lookup exceeded deadline (5000ms) — falling back to cache",
      weight: 5,
    },
    {
      service: "api-gateway",
      level: "WARN",
      message: "upstream customer-api p99 latency 9.4s exceeds circuit-breaker threshold",
      weight: 5,
      fields: { threshold: 3000, observed: 9400 },
    },
    {
      service: "api-gateway",
      level: "ERROR",
      message: "circuit breaker opened for upstream customer-api after 12 consecutive timeouts",
      weight: 3,
      minIntensity: 0.65,
    },
    {
      service: "payment-service",
      level: "ERROR",
      message: "transaction rolled back: could not obtain database connection",
      weight: 4,
    },
    {
      service: "notification-worker",
      level: "WARN",
      message: "queue depth {n} and growing; consumer stalled on database write",
      weight: 4,
    },
  ],

  ticketTemplates: [
    {
      subject: "Dashboard is extremely slow",
      body: "Pages that normally load instantly are taking 10+ seconds, and some eventually error out. Started about five minutes ago.",
      priority: "high",
      affectedService: "web-frontend",
      suggestedSteps: [
        "Check whether latency is rising uniformly or on specific endpoints",
        "Trace a slow request down to the data tier",
      ],
    },
    {
      subject: "API returning 500s intermittently",
      body: "About one in five calls to /api/projects comes back as a 500. The rest are slow but succeed.",
      priority: "urgent",
      affectedService: "customer-api",
      suggestedSteps: [
        "Look at p95/p99 rather than average latency",
        "Check the database connection pool utilisation",
      ],
    },
    {
      subject: "Report export never finishes",
      body: "I clicked export on our usage report twenty minutes ago and it's still processing.",
      priority: "normal",
      affectedService: "customer-api",
      suggestedSteps: ["Check for long-running queries holding connections"],
    },
    {
      subject: "Payments occasionally fail then succeed on retry",
      body: "Several of our customers reported a failed payment, but retrying worked. Is something wrong on your end?",
      priority: "high",
      affectedService: "payment-service",
      suggestedSteps: ["Correlate failures with database transaction rollbacks"],
    },
    {
      subject: "Notification emails delayed",
      body: "Our invite emails are arriving 15-20 minutes late.",
      priority: "low",
      affectedService: "notification-worker",
      suggestedSteps: ["Check queue depth and consumer throughput"],
    },
  ],

  diagnosisOptions: [
    { id: "database-overload", label: "Database connection exhaustion", feedback: "" },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback:
        "Run a lookup against an internal hostname — resolution is returning answers normally in a few milliseconds. Requests are reaching their destination; they're just not coming back quickly.",
    },
    {
      id: "cache-failure",
      label: "Redis cache failure",
      feedback:
        "Redis is not only healthy, its hit rate has gone up — it is absorbing traffic that would otherwise hit the database. That's a consequence of the problem, not the cause.",
    },
    {
      id: "application-bug",
      label: "Application bug in a recent deployment",
      feedback:
        "Reasonable instinct, but check the deployment history: no service shipped in this window. Notice too that several independent services degraded simultaneously — they share a dependency.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "Ping and traceroute to the data tier show normal round-trip times and no loss. The slowness is inside a service, not on the wire.",
    },
    {
      id: "third-party",
      label: "Third-party provider outage",
      feedback:
        "Payment failures are real, but internal services with no third-party dependency are equally affected. Look for the shared component.",
    },
  ],
  correctDiagnosisId: "database-overload",

  remediationOptions: [
    {
      id: "kill-long-queries",
      label: "Terminate long-running queries",
      description: "pg_terminate_backend on sessions running longer than 30 seconds.",
      durationSeconds: 10,
      ineffectiveNote:
        "Killing the queries released connections briefly, but the same unindexed query pattern refilled the pool within seconds.",
    },
    {
      id: "increase-connection-pool",
      label: "Increase connection pool capacity",
      description: "Raise max_connections and restart the pooler to admit queued clients.",
      durationSeconds: 18,
      ineffectiveNote:
        "More connections without clearing the stuck sessions just means more clients waiting on the same saturated database.",
    },
    {
      id: "restart-customer-api",
      label: "Restart Customer API",
      description: "Rolling restart of the customer API deployment.",
      durationSeconds: 20,
      ineffectiveNote:
        "The API restarted and immediately re-established connections to the same overloaded database. Latency did not improve.",
    },
    {
      id: "flush-redis",
      label: "Flush Redis cache",
      description: "Clear all cached keys to force fresh reads.",
      durationSeconds: 8,
      ineffectiveNote:
        "This made things worse: every cached read became a database read, adding load to a database that was already saturated.",
    },
    {
      id: "restore-dns-zone",
      label: "Restore DNS zone configuration",
      description: "Roll the internal zone back to the last known-good serial.",
      durationSeconds: 12,
      ineffectiveNote: "DNS was resolving correctly the whole time. No change.",
    },
    {
      id: "scale-frontend",
      label: "Scale up Web Frontend",
      description: "Add four more frontend replicas to absorb the load.",
      durationSeconds: 25,
      ineffectiveNote:
        "More frontend replicas generated more concurrent database requests, deepening the queue.",
    },
  ],
  // Both are needed and the order is the lesson: clear the stuck sessions, then
  // give the pool enough headroom to drain the backlog without re-saturating.
  requiredRemediationIds: ["kill-long-queries", "increase-connection-pool"],

  rootCause:
    "A reporting query against usage_events was running without a supporting index on (tenant_id, created_at). As traffic rose through the daily peak, each execution took progressively longer while holding a pooled connection open. Once the 200-connection pool was fully occupied, every other service queued behind it and began timing out at five seconds.",
  resolution:
    "The long-running sessions were terminated to release their connections, and pool capacity was raised to give the backlog room to drain. Latency returned to baseline as queued work cleared. Follow-up: add the missing composite index and set a statement timeout on the reporting role.",

  keyEvidence: [
    "Database connections pinned at 198–199 against a limit of 200",
    "Postgres logs show 'remaining connection slots are reserved' and an 8.4s sequential scan",
    "Redis hit rate rose rather than fell — the cache was absorbing, not causing, the problem",
    "Only database-backed services degraded; DNS, CDN and the queue stayed healthy",
    "Deployment history is empty for the hour before the incident",
  ],
};
