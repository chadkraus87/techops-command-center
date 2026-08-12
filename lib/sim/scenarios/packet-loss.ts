import type { Scenario } from "../types";

/**
 * Network Packet Loss.
 *
 * Teaching point: the only scenario whose signature lives in the network tools
 * rather than the application metrics. Error rates rise modestly and latency
 * becomes wildly *variable* rather than uniformly high — because TCP is
 * retransmitting. Ping and traceroute are what actually solve this one.
 */
export const packetLoss: Scenario = {
  id: "packet-loss",
  title: "Network Packet Loss",
  summary:
    "A failing link between the app and data tiers starts dropping packets. Latency becomes erratic and retries pile up.",
  difficulty: "advanced",
  severity: "SEV-2",
  affectedServices: ["primary-db", "redis-cache", "customer-api", "identity-service", "api-gateway"],
  expectedImpact:
    "Elevated packet loss on the data-tier subnet, highly variable latency, and TCP retransmission errors in the logs.",
  customerImpact:
    "Requests intermittently hang and time out. Retrying usually works, which makes the problem hard to report.",
  declareAfterSeconds: 65,
  recoverySeconds: 35,

  impacts: [
    { service: "primary-db", metric: "packetLoss", mode: "set", value: 0.14, rampSeconds: 30 },
    { service: "redis-cache", metric: "packetLoss", mode: "set", value: 0.12, rampSeconds: 30 },
    { service: "primary-db", metric: "latencyMs", mode: "multiply", value: 9, delaySeconds: 10, rampSeconds: 40 },
    { service: "redis-cache", metric: "latencyMs", mode: "multiply", value: 22, delaySeconds: 10, rampSeconds: 40 },
    { service: "primary-db", metric: "errorRate", mode: "set", value: 0.07, delaySeconds: 25, rampSeconds: 40 },

    { service: "customer-api", metric: "latencyMs", mode: "multiply", value: 5.5, delaySeconds: 15, rampSeconds: 40 },
    { service: "customer-api", metric: "errorRate", mode: "set", value: 0.11, delaySeconds: 30, rampSeconds: 40 },
    { service: "identity-service", metric: "latencyMs", mode: "multiply", value: 6, delaySeconds: 15, rampSeconds: 40 },
    { service: "identity-service", metric: "errorRate", mode: "set", value: 0.09, delaySeconds: 35, rampSeconds: 40 },
    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 3.4, delaySeconds: 25, rampSeconds: 40 },
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.08, delaySeconds: 40, rampSeconds: 40 },
    { service: "media-service", metric: "latencyMs", mode: "multiply", value: 2.6, delaySeconds: 30, rampSeconds: 40 },
  ],

  logTemplates: [
    {
      service: "customer-api",
      level: "WARN",
      message: "TCP retransmission to 10.20.30.21:5432 — {n} retries before success",
      weight: 9,
      fields: { peer: "10.20.30.21:5432", retries: 4 },
    },
    {
      service: "primary-db",
      level: "WARN",
      message: "client connection reset by peer during query execution",
      weight: 7,
      fields: { errno: "ECONNRESET" },
    },
    {
      service: "redis-cache",
      level: "WARN",
      message: "command timeout after 1000ms — no response from socket (packet loss suspected)",
      weight: 7,
    },
    {
      service: "identity-service",
      level: "ERROR",
      message: "read ETIMEDOUT 10.20.30.21:5432 after 5000ms",
      weight: 6,
      fields: { syscall: "read", errno: "ETIMEDOUT" },
    },
    {
      service: "api-gateway",
      level: "WARN",
      message: "p99 latency 8.2s while p50 held at 340ms — latency distribution is bimodal",
      weight: 5,
      fields: { p50: 340, p99: 8200 },
    },
    {
      service: "internal-api",
      level: "WARN",
      message: "health probe to data subnet 10.20.30.0/24 failed 3 of 10 attempts",
      weight: 5,
      minIntensity: 0.4,
    },
  ],

  ticketTemplates: [
    {
      subject: "Requests randomly hang then work on retry",
      body: "Maybe one in eight requests just hangs for 30 seconds and times out. If I retry immediately it works fine. Very hard to pin down.",
      priority: "high",
      affectedService: "customer-api",
      suggestedSteps: [
        "Compare p50 against p99 — a bimodal distribution points at the network",
        "Run a ping with enough packets to measure loss",
      ],
    },
    {
      subject: "Intermittent timeouts on our integration",
      body: "Our monitoring shows roughly 10% of calls timing out, but no consistent pattern by endpoint.",
      priority: "high",
      affectedService: "api-gateway",
      suggestedSteps: ["Check for TCP retransmissions between app and data tiers"],
    },
    {
      subject: "App feels unreliable today",
      body: "Sometimes instant, sometimes it just spins. Not sure how else to describe it.",
      priority: "normal",
      affectedService: "web-frontend",
      suggestedSteps: ["Run a traceroute to the data subnet and look for a lossy hop"],
    },
  ],

  diagnosisOptions: [
    { id: "network-congestion", label: "Network packet loss on the data-tier link", feedback: "" },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "Check the pool: connections are at their normal count and database CPU is low. A saturated database is uniformly slow — this is intermittently slow, which is a different shape entirely.",
    },
    {
      id: "cache-failure",
      label: "Cache layer failure",
      feedback:
        "Redis is responding and its hit rate is normal — but some commands time out. Both the cache and the database are affected equally, which points at what they have in common rather than either one.",
    },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback:
        "Resolution is fast and correct. Connections are being established successfully; the trouble starts after that.",
    },
    {
      id: "memory-leak",
      label: "Memory leak in a service",
      feedback:
        "Memory is flat across every service. Nothing is growing over time — the failures are randomly distributed instead.",
    },
  ],
  correctDiagnosisId: "network-congestion",

  remediationOptions: [
    {
      id: "reroute-data-link",
      label: "Fail over the data-tier link",
      description: "Shift the 10.20.30.0/24 path onto the redundant uplink and drain the faulty interface.",
      durationSeconds: 28,
      ineffectiveNote: "",
    },
    {
      id: "restart-customer-api",
      label: "Restart Customer API",
      description: "Rolling restart of the API deployment.",
      durationSeconds: 20,
      ineffectiveNote: "New pods experienced exactly the same intermittent timeouts. The processes were never at fault.",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections on the primary.",
      durationSeconds: 15,
      ineffectiveNote: "The pool was never near its limit. No effect on the timeouts.",
    },
    {
      id: "restart-redis",
      label: "Restart Redis",
      description: "Restart the cache node.",
      durationSeconds: 20,
      ineffectiveNote:
        "Redis came back and immediately resumed timing out on the same lossy path, while the cache warmed from cold.",
    },
    {
      id: "scale-customer-api",
      label: "Scale up Customer API",
      description: "Add replicas to absorb retries.",
      durationSeconds: 22,
      ineffectiveNote: "More replicas meant more connections over the same failing link, and slightly more retransmissions.",
    },
  ],
  requiredRemediationIds: ["reroute-data-link"],

  rootCause:
    "A degrading transceiver on the primary uplink to the 10.20.30.0/24 data subnet began dropping roughly 12–14% of frames. TCP masked the loss with retransmissions, which is why most requests still succeeded — but any request unlucky enough to hit repeated drops blew through its five-second timeout. The bimodal latency distribution, fast p50 and catastrophic p99, is the signature.",
  resolution:
    "Traffic was failed over to the redundant uplink and the faulty interface drained for hardware replacement. Retransmissions stopped immediately and the latency distribution collapsed back to a single mode. Follow-up: alert on interface error counters, not just link state.",

  keyEvidence: [
    "Ping to the data subnet shows 12–14% packet loss with high jitter",
    "p50 latency is near normal while p99 is catastrophic — a bimodal distribution",
    "Both Redis and Postgres are affected equally, despite being unrelated services on the same subnet",
    "Logs show TCP retransmissions and ECONNRESET rather than application errors",
    "Database connection count and CPU never left baseline",
  ],
};
