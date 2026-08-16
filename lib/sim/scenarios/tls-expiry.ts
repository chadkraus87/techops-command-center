import type { Scenario } from "../types";

/**
 * Expired TLS Certificate.
 *
 * Teaching point: a total, instantaneous, *clean* failure. There is no ramp and
 * no partial degradation — connections are refused at the handshake, so latency
 * barely moves while error rate goes vertical. Anything that speaks TLS to the
 * internal mesh dies at once; anything that doesn't is untouched.
 */
export const tlsExpiry: Scenario = {
  id: "tls-expiry",
  title: "Expired TLS Certificate",
  summary:
    "The internal service-mesh certificate expires. Handshakes are refused instantly across every authenticated hop.",
  difficulty: "starter",
  severity: "SEV-1",
  affectedServices: [
    "load-balancer",
    "api-gateway",
    "identity-service",
    "customer-api",
    "payment-service",
    "web-frontend",
  ],
  expectedImpact:
    "Error rate goes vertical within seconds with almost no change in latency — the mark of a connection refused rather than a request that failed.",
  customerImpact:
    "The site returns security warnings and connection errors. Nothing loads for anyone, in any region.",
  declareAfterSeconds: 35,
  recoverySeconds: 30,

  impacts: [
    // No ramp: TLS either validates or it does not.
    { service: "load-balancer", metric: "errorRate", mode: "set", value: 0.94, rampSeconds: 6 },
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.91, rampSeconds: 8 },
    { service: "identity-service", metric: "errorRate", mode: "set", value: 0.88, rampSeconds: 8 },
    { service: "customer-api", metric: "errorRate", mode: "set", value: 0.86, rampSeconds: 10 },
    { service: "payment-service", metric: "errorRate", mode: "set", value: 0.9, rampSeconds: 10 },
    { service: "web-frontend", metric: "errorRate", mode: "set", value: 0.89, rampSeconds: 8 },

    // Latency actually *falls* — failing fast is quick.
    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 0.35, rampSeconds: 10 },
    { service: "customer-api", metric: "latencyMs", mode: "multiply", value: 0.3, rampSeconds: 10 },
    { service: "web-frontend", metric: "latencyMs", mode: "multiply", value: 0.4, rampSeconds: 10 },

    // Traffic collapses as clients stop retrying against a hard failure.
    { service: "load-balancer", metric: "rps", mode: "multiply", value: 0.3, delaySeconds: 20, rampSeconds: 40 },
    { service: "api-gateway", metric: "rps", mode: "multiply", value: 0.28, delaySeconds: 20, rampSeconds: 40 },
    { service: "edge-cdn", metric: "errorRate", mode: "set", value: 0.35, delaySeconds: 15, rampSeconds: 25 },
  ],

  logTemplates: [
    {
      service: "load-balancer",
      level: "CRITICAL",
      message:
        "TLS handshake failed: certificate has expired (notAfter=2026-08-11T13:00:00Z) for *.internal.meridian.io",
      weight: 10,
      fields: { notAfter: "2026-08-11T13:00:00Z", issuer: "Meridian Internal CA", serial: "3f:a2:91:0c" },
    },
    {
      service: "api-gateway",
      level: "ERROR",
      message: "x509: certificate has expired or is not yet valid — upstream customer-api",
      weight: 9,
      fields: { errorCode: "CERT_HAS_EXPIRED" },
    },
    {
      service: "web-frontend",
      level: "ERROR",
      message: "fetch failed: unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)",
      weight: 7,
    },
    {
      service: "identity-service",
      level: "CRITICAL",
      message: "mTLS peer verification rejected — refusing all inbound connections",
      weight: 6,
    },
    {
      service: "payment-service",
      level: "ERROR",
      message: "SSL routines:tls_process_server_certificate:certificate verify failed",
      weight: 5,
    },
    {
      service: "load-balancer",
      level: "WARN",
      message: "certificate renewal job last succeeded 89 days ago; ACME renewal never re-ran",
      weight: 3,
    },
  ],

  ticketTemplates: [
    {
      subject: "Security warning when visiting your site",
      body: "My browser is showing a big red warning saying the connection isn't private and the certificate expired. Is this a phishing site?",
      priority: "urgent",
      affectedService: "load-balancer",
      suggestedSteps: [
        "Check the certificate expiry on the edge and the internal mesh separately",
        "Confirm whether error rate rose without a matching latency rise",
      ],
    },
    {
      subject: "Complete outage — nothing loads",
      body: "The entire application is down for our whole company. We get connection errors on every page.",
      priority: "urgent",
      affectedService: "web-frontend",
      suggestedSteps: ["Look at the shape of the failure: instant and total suggests a handshake, not a resource"],
    },
    {
      subject: "Our API integration stopped working suddenly",
      body: "All our API calls started failing at the same moment with SSL errors. Nothing changed on our end.",
      priority: "urgent",
      affectedService: "api-gateway",
      suggestedSteps: ["Check certificate validity dates against the incident start time"],
    },
  ],

  diagnosisOptions: [
    { id: "tls-expiry", label: "Expired TLS certificate", feedback: "" },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback:
        "Lookups return correct answers quickly. Clients are finding the right host and connecting to it — the connection is being refused after that, during the handshake.",
    },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "The database is idle: connections and CPU are at baseline, because almost no requests are reaching it. Note that latency fell — an overloaded system gets slower, not faster.",
    },
    {
      id: "auth-failure",
      label: "Authentication service failure",
      feedback:
        "Close in spirit — this is an identity problem, but at the transport layer rather than the application layer. Services that never call the identity service are failing too.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "Packets are flowing perfectly: no loss, normal round-trip times. The TCP connection succeeds and then something rejects it.",
    },
  ],
  correctDiagnosisId: "tls-expiry",

  remediationOptions: [
    {
      id: "renew-certificate",
      label: "Renew and deploy the TLS certificate",
      description: "Issue a fresh certificate from the internal CA and push it to every terminating node.",
      durationSeconds: 22,
      ineffectiveNote: "",
    },
    {
      id: "reload-tls-config",
      label: "Reload TLS configuration across the mesh",
      description: "Signal every proxy to re-read its certificate bundle from disk.",
      durationSeconds: 10,
      ineffectiveNote:
        "Reloading before a valid certificate exists just re-reads the same expired file. Do this after issuing the new certificate, not instead of it.",
    },
    {
      id: "restart-api-gateway",
      label: "Restart API Gateway",
      description: "Rolling restart of gateway pods.",
      durationSeconds: 20,
      ineffectiveNote: "The gateway restarted and loaded the same expired certificate.",
    },
    {
      id: "failover-cdn",
      label: "Fail over CDN to secondary provider",
      description: "Shift edge traffic to the backup provider.",
      durationSeconds: 25,
      ineffectiveNote: "The secondary provider connects to the same origin and fails the same handshake.",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections on the primary.",
      durationSeconds: 15,
      ineffectiveNote: "The database is idle. This changed nothing.",
    },
  ],
  // Issue first, then reload — the order is the whole lesson.
  requiredRemediationIds: ["renew-certificate", "reload-tls-config"],

  rootCause:
    "The wildcard certificate for *.internal.meridian.io expired at 13:00 UTC. The ACME renewal job had been failing silently for 89 days because its credential had been rotated without updating the job, and the expiry alert was routed to a decommissioned channel. At the moment of expiry every mutually-authenticated hop in the service mesh began refusing connections.",
  resolution:
    "A replacement certificate was issued from the internal CA and distributed to every terminating proxy, then the mesh was signalled to reload. Handshakes succeeded immediately and traffic recovered as clients retried. Follow-up: restore expiry alerting and fail the renewal job loudly.",

  hints: [
    {
      title: "Look at the shape, not just the size",
      body: "Errors went from near zero to near total instantly, with no ramp. Gradual problems build; this one flipped. That shape narrows the possibilities enormously.",
    },
    {
      title: "Requests are failing faster than normal",
      body: "Check latency alongside the errors. It went down, not up. An overloaded system gets slower — this one is rejecting work immediately, before doing any of it.",
    },
    {
      title: "Connections are refused at the handshake",
      body: "Something is rejecting connections before any request is processed. Read the load balancer logs — they name the exact reason, and the timestamp matches the moment everything broke.",
    },
  ],

  keyEvidence: [
    "Error rate went vertical with no ramp — a handshake refusal, not a resource exhaustion",
    "Latency fell while errors rose: requests were failing fast rather than timing out",
    "Logs name the exact failure: x509 certificate has expired, with the notAfter timestamp",
    "The incident start time matches the certificate's expiry to the second",
  ],
};
