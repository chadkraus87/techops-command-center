import type { Scenario } from "../types";

/**
 * Third-Party Payment Provider Outage.
 *
 * Teaching point: the failure is outside your perimeter. Every service you own
 * is healthy, and the correct response is not to fix anything — it is to stop
 * the bleeding (fail over, queue for later) and communicate. Restarting your own
 * services is pure motion.
 */
export const paymentProviderOutage: Scenario = {
  id: "payment-provider-outage",
  title: "Third-Party Payment Provider Outage",
  summary:
    "The upstream payment processor stops responding. Checkout fails while everything you actually operate stays green.",
  difficulty: "starter",
  severity: "SEV-3",
  affectedServices: ["payment-service", "notification-worker", "message-queue"],
  expectedImpact:
    "Checkout error rate climbs sharply with very high latency as calls sit waiting for a provider that never answers. No other service is affected.",
  customerImpact:
    "Customers cannot complete purchases or update billing details. Everything else in the product works normally.",
  declareAfterSeconds: 45,
  recoverySeconds: 30,

  impacts: [
    // Waiting on a dead upstream: latency pinned at the timeout ceiling.
    { service: "payment-service", metric: "latencyMs", mode: "set", value: 29500, rampSeconds: 25 },
    { service: "payment-service", metric: "errorRate", mode: "set", value: 0.82, delaySeconds: 8, rampSeconds: 30 },
    { service: "payment-service", metric: "cpu", mode: "add", value: -8, delaySeconds: 20, rampSeconds: 30 },
    { service: "payment-service", metric: "rps", mode: "multiply", value: 0.55, delaySeconds: 35, rampSeconds: 40 },

    // Retries queue up for later delivery.
    { service: "message-queue", metric: "queueDepth", mode: "multiply", value: 5.5, delaySeconds: 25, rampSeconds: 50 },
    { service: "notification-worker", metric: "queueDepth", mode: "multiply", value: 4, delaySeconds: 30, rampSeconds: 50 },
    { service: "notification-worker", metric: "errorRate", mode: "set", value: 0.14, delaySeconds: 35, rampSeconds: 40 },

    // The gateway barely notices — payments are 6% of its traffic.
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.05, delaySeconds: 30, rampSeconds: 40 },
  ],

  logTemplates: [
    {
      service: "payment-service",
      level: "ERROR",
      message: "provider request timed out after 30000ms — POST https://api.paycrest.example/v2/charges",
      weight: 10,
      fields: { provider: "paycrest", timeoutMs: 30000, attempt: 3 },
    },
    {
      service: "payment-service",
      level: "ERROR",
      message: "provider returned 503 Service Unavailable (retry-after: 120)",
      weight: 7,
      fields: { statusCode: 503, retryAfter: 120 },
    },
    {
      service: "payment-service",
      level: "WARN",
      message: "circuit breaker half-open for provider paycrest; probe failed, re-opening",
      weight: 5,
      minIntensity: 0.5,
    },
    {
      service: "payment-service",
      level: "INFO",
      message: "charge {n} queued for retry; idempotency key retained",
      weight: 5,
    },
    {
      service: "message-queue",
      level: "WARN",
      message: "payment-retry queue depth {n} — consumers blocked on upstream provider",
      weight: 5,
      minIntensity: 0.4,
    },
    {
      service: "notification-worker",
      level: "WARN",
      message: "receipt email deferred — awaiting charge confirmation",
      weight: 4,
    },
  ],

  ticketTemplates: [
    {
      subject: "Checkout failing",
      body: "I've tried to pay three times with two different cards. It spins for about thirty seconds and then says the payment couldn't be processed.",
      priority: "urgent",
      affectedService: "payment-service",
      suggestedSteps: [
        "Confirm whether our service or the provider is failing",
        "Check the provider's status page before touching our own systems",
      ],
    },
    {
      subject: "Was I charged? No receipt",
      body: "The payment page errored but I want to be sure I wasn't double charged. I haven't received a receipt email.",
      priority: "high",
      affectedService: "payment-service",
      suggestedSteps: ["Verify idempotency keys prevented duplicate charges", "Check the deferred receipt queue"],
    },
    {
      subject: "Can't update our billing card",
      body: "Trying to swap the card on our account and it just errors every time. The rest of the app works fine.",
      priority: "normal",
      affectedService: "payment-service",
      suggestedSteps: ["Confirm the blast radius is limited to payment flows"],
    },
  ],

  diagnosisOptions: [
    { id: "third-party", label: "Third-party provider outage", feedback: "" },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "The database is healthy and every other database-backed service is unaffected. If the database were the problem, checkout would not be the only thing failing.",
    },
    {
      id: "application-bug",
      label: "Application bug in a recent deployment",
      feedback:
        "Payment Service has not shipped a release in nine days — check the deployment history. The logs also show the failure happening at an outbound HTTP call, not in our own code path.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "Internal network paths are clean. The only failing calls are outbound to one external host, which is a much narrower pattern than a congested link.",
    },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback:
        "The provider hostname resolves fine and the TCP connection is established — the request is sent and simply never answered.",
    },
  ],
  correctDiagnosisId: "third-party",

  remediationOptions: [
    {
      id: "failover-payment-provider",
      label: "Fail over to the secondary payment provider",
      description: "Route new charges to the backup processor and replay the retry queue against it.",
      durationSeconds: 26,
      ineffectiveNote: "",
    },
    {
      id: "restart-payment-service",
      label: "Restart Payment Service",
      description: "Rolling restart of the payment deployment.",
      durationSeconds: 18,
      ineffectiveNote:
        "The service was healthy. Restarting it dropped the in-flight retry queue and achieved nothing else.",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections on the primary.",
      durationSeconds: 15,
      ineffectiveNote: "The database was never involved. No change.",
    },
    {
      id: "flush-redis",
      label: "Flush Redis cache",
      description: "Clear cached keys.",
      durationSeconds: 8,
      ineffectiveNote: "Unrelated, and it added avoidable database load during an active incident.",
    },
    {
      id: "purge-cdn-cache",
      label: "Purge CDN cache",
      description: "Invalidate edge objects.",
      durationSeconds: 20,
      ineffectiveNote: "The checkout failure happens server-side, well past the edge. No effect.",
    },
  ],
  requiredRemediationIds: ["failover-payment-provider"],

  rootCause:
    "The upstream processor, Paycrest, suffered a regional outage and stopped answering charge requests, returning 503s and then nothing at all. Every Meridian-operated service remained healthy throughout — the failure was entirely outside the perimeter, surfacing only through the one service that depends on it.",
  resolution:
    "Charges were failed over to the secondary processor and the retry queue replayed against it with the original idempotency keys, so no customer was double-charged. Deferred receipts were delivered once confirmations arrived. Follow-up: shorten the provider timeout from 30s to 8s so failures surface before the customer gives up.",

  hints: [
    {
      title: "Check how narrow the damage is",
      body: "Only checkout is failing. Sign-in, the dashboard, images and the API all work normally. A shared internal fault would not be this contained.",
    },
    {
      title: "Everything you operate is healthy",
      body: "Database, cache, queue and every internal service are green. If nothing you run is broken, the failing dependency is not something you run.",
    },
    {
      title: "The failing call leaves your network",
      body: "Read the payment service logs. The failure is an outbound request to an external company's address, timing out after thirty seconds. You cannot fix their systems — but you can stop sending customers into them.",
    },
  ],

  keyEvidence: [
    "Every service you operate is healthy — CPU, memory, database and cache all at baseline",
    "The blast radius is exactly one service, and it is the only one with an external dependency",
    "Latency pinned at ~30s: the client-side timeout, meaning nobody is answering",
    "Logs show an outbound HTTPS call to a third-party host timing out, not an internal error",
    "No deployment to Payment Service in the preceding nine days",
  ],
};
