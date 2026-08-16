import type { Scenario } from "../types";

/**
 * DNS Resolution Failure.
 *
 * The teaching point: the failure is *upstream of everything*, so almost every
 * service looks broken at once — but the databases and caches are provably
 * healthy. The tell is that `ping` by IP succeeds while `dig` returns SERVFAIL,
 * and the logs are full of resolver errors rather than query errors.
 */
export const dnsFailure: Scenario = {
  id: "dns-failure",
  title: "DNS Resolution Failure",
  summary:
    "Internal name resolution starts failing. Services can no longer find each other, even though every host is up.",
  difficulty: "starter",
  severity: "SEV-1",
  affectedServices: [
    "dns-resolver",
    "api-gateway",
    "web-frontend",
    "identity-service",
    "customer-api",
    "media-service",
    "payment-service",
    "edge-cdn",
  ],
  expectedImpact:
    "Widespread request failures across every customer-facing surface within ~30 seconds. Data stores remain healthy.",
  customerImpact:
    "Customers cannot load the dashboard, sign in, or complete checkout. Cached pages continue to serve briefly.",
  declareAfterSeconds: 45,
  recoverySeconds: 40,

  impacts: [
    // The resolver itself: answering, but answering with failures.
    { service: "dns-resolver", metric: "errorRate", mode: "set", value: 0.92, rampSeconds: 15 },
    { service: "dns-resolver", metric: "latencyMs", mode: "multiply", value: 45, rampSeconds: 20 },

    // Everything that resolves a hostname before making a call.
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.44, delaySeconds: 8, rampSeconds: 25 },
    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 6, delaySeconds: 8, rampSeconds: 25 },
    { service: "identity-service", metric: "errorRate", mode: "set", value: 0.38, delaySeconds: 12, rampSeconds: 25 },
    { service: "identity-service", metric: "latencyMs", mode: "multiply", value: 5, delaySeconds: 12, rampSeconds: 25 },
    { service: "customer-api", metric: "errorRate", mode: "set", value: 0.32, delaySeconds: 15, rampSeconds: 30 },
    { service: "customer-api", metric: "latencyMs", mode: "multiply", value: 5, delaySeconds: 15, rampSeconds: 30 },
    { service: "web-frontend", metric: "errorRate", mode: "set", value: 0.35, delaySeconds: 12, rampSeconds: 30 },
    { service: "web-frontend", metric: "latencyMs", mode: "multiply", value: 5, delaySeconds: 12, rampSeconds: 30 },
    { service: "media-service", metric: "errorRate", mode: "set", value: 0.33, delaySeconds: 18, rampSeconds: 30 },
    { service: "payment-service", metric: "errorRate", mode: "set", value: 0.3, delaySeconds: 20, rampSeconds: 30 },

    // The edge keeps serving from cache for a while, so it fails last and least.
    { service: "edge-cdn", metric: "errorRate", mode: "set", value: 0.2, delaySeconds: 25, rampSeconds: 40 },
    { service: "edge-cdn", metric: "cacheHitRate", mode: "set", value: 0.99, delaySeconds: 25, rampSeconds: 30 },

    // Traffic drops as clients give up retrying — a real and often-missed signal.
    { service: "api-gateway", metric: "rps", mode: "multiply", value: 0.62, delaySeconds: 40, rampSeconds: 60 },
  ],

  logTemplates: [
    {
      service: "dns-resolver",
      level: "ERROR",
      message: "SERVFAIL for query customer-api.internal.meridian.io. IN A from 10.20.12.44",
      weight: 10,
      fields: { qtype: "A", rcode: "SERVFAIL", zone: "internal.meridian.io" },
    },
    {
      service: "dns-resolver",
      level: "ERROR",
      message: "zone internal.meridian.io: no valid records loaded, serial 2026081101 rejected",
      weight: 4,
      fields: { zone: "internal.meridian.io", serial: 2026081101 },
    },
    {
      service: "dns-resolver",
      level: "WARN",
      message: "upstream forwarder 10.20.0.2:53 timed out after 5000ms",
      weight: 3,
    },
    {
      service: "api-gateway",
      level: "ERROR",
      message:
        "dial tcp: lookup customer-api.internal.meridian.io on 10.20.0.53:53: server misbehaving",
      weight: 9,
      fields: { upstream: "customer-api", resolver: "10.20.0.53" },
    },
    {
      service: "api-gateway",
      level: "ERROR",
      message: "upstream connect error or disconnect before headers; reset reason: connection failure",
      weight: 6,
      fields: { statusCode: 503 },
    },
    {
      service: "web-frontend",
      level: "ERROR",
      message: "getaddrinfo EAI_AGAIN api-01.internal.meridian.io",
      weight: 7,
      fields: { errno: -3001, syscall: "getaddrinfo" },
    },
    {
      service: "identity-service",
      level: "ERROR",
      message: "failed to resolve pg-primary-01.internal.meridian.io: no such host",
      weight: 6,
    },
    {
      service: "identity-service",
      level: "CRITICAL",
      message: "token verification unavailable — cannot reach identity backing store",
      weight: 2,
      minIntensity: 0.6,
    },
    {
      service: "edge-cdn",
      level: "WARN",
      message: "origin resolution failed; serving stale object from cache (age 412s)",
      weight: 5,
      fields: { staleAge: 412, origin: "lb.internal" },
    },
    {
      service: "media-service",
      level: "ERROR",
      message: "asset signing failed: DNS lookup for cdn.meridiancloud.io returned no answer",
      weight: 4,
    },
    {
      service: "payment-service",
      level: "ERROR",
      message: "payment provider handshake aborted: unable to resolve gateway hostname",
      weight: 3,
    },
  ],

  ticketTemplates: [
    {
      subject: "Dashboard will not load",
      body: "I've been trying to open my dashboard for the last few minutes and it just spins, then shows a blank page with an error. I've tried two browsers and my phone.",
      priority: "urgent",
      affectedService: "web-frontend",
      suggestedSteps: [
        "Confirm whether the failure is global or isolated to one region",
        "Check the API gateway error rate before assuming a frontend bug",
        "Look for resolver errors in the gateway logs",
      ],
    },
    {
      subject: "Unable to log in — 'service unavailable'",
      body: "Every time I enter my password I get a 503 page. My team can't get in either. Nothing changed on our side.",
      priority: "urgent",
      affectedService: "identity-service",
      suggestedSteps: [
        "Verify the identity service is reachable by IP",
        "Check whether auth failures are credential errors or connection errors",
      ],
    },
    {
      subject: "API requests timing out from our integration",
      body: "Our nightly sync job is failing with connection errors against api.meridiancloud.io. We're seeing 503s on roughly every request.",
      priority: "high",
      affectedService: "api-gateway",
      suggestedSteps: [
        "Compare error rate across endpoints — a shared cause points upstream",
        "Run a DNS lookup against an internal hostname",
      ],
    },
    {
      subject: "Checkout is failing for our customers",
      body: "We're getting an error at the payment step. This is costing us orders — please treat as urgent.",
      priority: "urgent",
      affectedService: "payment-service",
      suggestedSteps: ["Check whether the payment provider or our own egress path is failing"],
    },
    {
      subject: "Images and thumbnails not loading",
      body: "Product images are showing as broken placeholders across our whole storefront.",
      priority: "high",
      affectedService: "media-service",
      suggestedSteps: ["Check CDN origin fetch errors", "Confirm asset signing is succeeding"],
    },
  ],

  diagnosisOptions: [
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback: "",
    },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "Check the database metrics before committing to this. Connection count and CPU on the primary are sitting at their normal levels — a saturated database looks very different.",
    },
    {
      id: "application-bug",
      label: "Application bug in a recent deployment",
      feedback:
        "Nothing shipped in the window before this started — check the deployment history. Also note the failure is not confined to one service, which a code regression usually would be.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "Close, but measure it. Ping an internal host by IP: round-trip times and loss are normal, so packets are flowing fine. Something else is breaking before the connection is made.",
    },
    {
      id: "cdn-issue",
      label: "CDN regional outage",
      feedback:
        "The CDN is the least affected service here — it is still serving from cache. Failures that start at the edge do not usually take out internal service-to-service calls.",
    },
    {
      id: "auth-failure",
      label: "Authentication service failure",
      feedback:
        "Identity is failing, but so is everything else including services that never call it. Look for the common factor further upstream.",
    },
  ],
  correctDiagnosisId: "dns-failure",

  remediationOptions: [
    {
      id: "restore-dns-zone",
      label: "Restore DNS zone configuration",
      description: "Roll the internal.meridian.io zone back to the last known-good serial.",
      durationSeconds: 12,
      ineffectiveNote: "",
    },
    {
      id: "flush-resolver-cache",
      label: "Flush resolver caches",
      description: "Clear negative caches on all resolvers so clients stop serving cached NXDOMAIN.",
      durationSeconds: 8,
      ineffectiveNote:
        "Flushing caches alone does nothing while the zone itself is still broken — clients simply re-fetch the same bad answer.",
    },
    {
      id: "restart-api-gateway",
      label: "Restart API Gateway",
      description: "Rolling restart of all gateway pods.",
      durationSeconds: 20,
      ineffectiveNote:
        "The gateway restarted cleanly and immediately began failing the same lookups. The gateway was never the problem.",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections on the primary and reload.",
      durationSeconds: 15,
      ineffectiveNote:
        "The pool was never under pressure. Raising the limit changed nothing and left the database configured for load it does not have.",
    },
    {
      id: "failover-cdn",
      label: "Fail over CDN to secondary provider",
      description: "Shift edge traffic to the backup CDN.",
      durationSeconds: 25,
      ineffectiveNote:
        "The secondary CDN needs to resolve the same origin hostname, so it fails in exactly the same way.",
    },
    {
      id: "restart-frontend",
      label: "Restart Web Frontend",
      description: "Rolling restart of the frontend deployment.",
      durationSeconds: 18,
      ineffectiveNote: "The frontend came back healthy and still cannot resolve the API hostname.",
    },
  ],
  // Order matters: fixing the zone is what actually resolves it, but stale
  // negative caches keep clients broken until they are cleared too.
  requiredRemediationIds: ["restore-dns-zone", "flush-resolver-cache"],

  rootCause:
    "A zone-file deployment to the internal resolvers removed the A records for internal.meridian.io. The resolvers loaded the malformed zone, rejected the new serial, and began answering SERVFAIL for every internal hostname. Every service-to-service call failed at name resolution, before a single packet was sent.",
  resolution:
    "The zone was rolled back to the previous known-good serial and negative caches were flushed across all resolvers. Name resolution recovered immediately and dependent services drained their retry backlogs over the following minute.",

  hints: [
    {
      title: "Start by asking what is NOT broken",
      body: "Almost every service is red, which feels like everything failed at once. Real outages rarely work that way. Open Infrastructure and look for the services that stayed green — what they have in common is usually the answer.",
    },
    {
      title: "The data tier is completely healthy",
      body: "The database, the cache and the message queue are all fine: normal CPU, normal connections, no errors. So the stored data is reachable and intact. Something is going wrong before requests ever get there.",
    },
    {
      title: "Services cannot find each other",
      body: "Open Network and try reaching a service two ways: by its name, then by its numeric address. One works and one does not. That gap is the whole incident — the machines are up, but nothing can look up where they live.",
    },
  ],

  keyEvidence: [
    "DNS resolver error rate above 90% while every data store stayed healthy",
    "`dig api.internal` returns SERVFAIL, but `ping 10.20.12.44` succeeds — the hosts are up",
    "Gateway logs show 'server misbehaving' from 10.20.0.53, not query or connection errors",
    "Database CPU and connection count never left their normal range",
  ],
};
