import type { Scenario } from "../types";

/**
 * CDN Regional Outage.
 *
 * Teaching point: partial-population failures. Origin services are completely
 * healthy — the only thing that moved is edge error rate and cache hit rate,
 * and only for one region. Internal metrics look fine, which is exactly why
 * edge outages are so often missed.
 */
export const cdnOutage: Scenario = {
  id: "cdn-outage",
  title: "CDN Regional Outage",
  summary:
    "An edge region stops serving. Origin is perfectly healthy, so internal dashboards look almost normal.",
  difficulty: "intermediate",
  severity: "SEV-2",
  affectedServices: ["edge-cdn", "web-frontend", "media-service"],
  expectedImpact:
    "Edge error rate spikes and cache hit rate collapses. Origin request volume rises as the edge stops absorbing traffic.",
  customerImpact:
    "Customers in the affected region see missing assets, unstyled pages and slow loads. Other regions are unaffected.",
  declareAfterSeconds: 50,
  recoverySeconds: 40,

  impacts: [
    { service: "edge-cdn", metric: "errorRate", mode: "set", value: 0.41, rampSeconds: 25 },
    { service: "edge-cdn", metric: "cacheHitRate", mode: "set", value: 0.11, rampSeconds: 30 },
    { service: "edge-cdn", metric: "latencyMs", mode: "multiply", value: 14, rampSeconds: 30 },
    { service: "edge-cdn", metric: "rps", mode: "multiply", value: 0.58, delaySeconds: 20, rampSeconds: 40 },

    // Traffic the edge used to absorb now lands on origin.
    { service: "load-balancer", metric: "rps", mode: "multiply", value: 2.4, delaySeconds: 15, rampSeconds: 35 },
    { service: "web-frontend", metric: "rps", mode: "multiply", value: 2.6, delaySeconds: 15, rampSeconds: 35 },
    { service: "web-frontend", metric: "latencyMs", mode: "multiply", value: 3.2, delaySeconds: 20, rampSeconds: 35 },
    { service: "web-frontend", metric: "cpu", mode: "add", value: 34, delaySeconds: 20, rampSeconds: 35 },
    { service: "media-service", metric: "rps", mode: "multiply", value: 3.1, delaySeconds: 20, rampSeconds: 35 },
    { service: "media-service", metric: "latencyMs", mode: "multiply", value: 2.8, delaySeconds: 25, rampSeconds: 35 },
    { service: "media-service", metric: "cpu", mode: "add", value: 28, delaySeconds: 25, rampSeconds: 35 },
  ],

  logTemplates: [
    {
      service: "edge-cdn",
      level: "CRITICAL",
      message: "edge region eu-west-1 reporting 0 healthy PoPs — withdrawing anycast announcement",
      weight: 8,
      fields: { region: "eu-west-1", healthyPops: 0 },
    },
    {
      service: "edge-cdn",
      level: "ERROR",
      message: "GET /assets/app.{n}.css failed at edge: 502 from PoP dub-03",
      weight: 8,
      fields: { statusCode: 502, pop: "dub-03" },
    },
    {
      service: "edge-cdn",
      level: "WARN",
      message: "cache hit ratio {n}% — objects evicted during PoP failover",
      weight: 5,
    },
    {
      service: "load-balancer",
      level: "WARN",
      message: "inbound connections up 240% — edge offload has stopped",
      weight: 5,
      minIntensity: 0.4,
    },
    {
      service: "web-frontend",
      level: "WARN",
      message: "serving static asset directly from origin (bypassing edge)",
      weight: 6,
    },
    {
      service: "media-service",
      level: "WARN",
      message: "origin image requests {n}/s — well above provisioned edge-offload baseline",
      weight: 4,
      minIntensity: 0.5,
    },
  ],

  ticketTemplates: [
    {
      subject: "Site looks broken — no styling",
      body: "The page loads but it's just unstyled text with no images. Colleague in the US says it looks fine for them.",
      priority: "urgent",
      affectedService: "edge-cdn",
      suggestedSteps: [
        "Ask which region the reporter is in — a regional split is the key signal",
        "Compare edge error rate against origin error rate",
      ],
    },
    {
      subject: "Very slow page loads from our London office",
      body: "Pages take 15-20 seconds. Our New York team has no issues at all.",
      priority: "high",
      affectedService: "edge-cdn",
      suggestedSteps: ["Check per-region edge health", "Verify origin is healthy before escalating"],
    },
    {
      subject: "Images not displaying",
      body: "Product images fail to load about half the time. Refreshing sometimes fixes it.",
      priority: "normal",
      affectedService: "media-service",
      suggestedSteps: ["Check whether failures are at the edge or the origin"],
    },
  ],

  diagnosisOptions: [
    { id: "cdn-issue", label: "CDN regional outage", feedback: "" },
    {
      id: "application-bug",
      label: "Application bug in a recent deployment",
      feedback:
        "No deployment matches this window, and the failure is geographic rather than functional — the same URL works from one region and not another. Code does not behave that way.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "Loss and round-trip times inside the network are normal. The problem is at the edge tier, before traffic reaches your network at all.",
    },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "The database is comfortably within limits. Note that the assets failing to load are static files that never touch a database.",
    },
    {
      id: "memory-leak",
      label: "Memory leak in a service",
      feedback:
        "Memory is stable across the fleet. Origin CPU rose, but only because it is suddenly serving traffic the edge used to absorb — a consequence, not a cause.",
    },
  ],
  correctDiagnosisId: "cdn-issue",

  remediationOptions: [
    {
      id: "failover-cdn-region",
      label: "Fail edge traffic over to healthy regions",
      description: "Withdraw the failed region from anycast and re-route to us-east-1 and ap-southeast-2.",
      durationSeconds: 25,
      ineffectiveNote: "",
    },
    {
      id: "purge-cdn-cache",
      label: "Purge CDN cache",
      description: "Invalidate all cached objects to force a refresh.",
      durationSeconds: 20,
      ineffectiveNote:
        "Purging made it worse — the healthy regions lost their warm caches too, so origin load rose further.",
    },
    {
      id: "scale-frontend",
      label: "Scale up Web Frontend",
      description: "Add replicas to absorb the origin traffic.",
      durationSeconds: 25,
      ineffectiveNote:
        "This relieved origin CPU but did nothing for customers in the failed region, who still cannot reach an edge node.",
    },
    {
      id: "restart-media-service",
      label: "Restart Media Service",
      description: "Rolling restart of media workers.",
      durationSeconds: 15,
      ineffectiveNote: "Media was healthy; restarting it briefly reduced capacity during peak origin load.",
    },
    {
      id: "restore-dns-zone",
      label: "Restore DNS zone configuration",
      description: "Roll the zone back to the previous serial.",
      durationSeconds: 12,
      ineffectiveNote: "The zone was never modified and resolution is working. No change.",
    },
  ],
  requiredRemediationIds: ["failover-cdn-region"],

  rootCause:
    "A control-plane push to the eu-west-1 edge region left every point of presence failing its health check. The region kept announcing its anycast prefix while returning 502s, so European traffic was routed to nodes that could not serve it. Origin infrastructure was healthy throughout and simply absorbed the traffic the edge stopped offloading.",
  resolution:
    "The failed region was withdrawn from the anycast announcement and traffic re-routed to healthy regions. Edge error rate returned to baseline immediately; cache hit rate recovered over the next few minutes as the surviving regions warmed. Follow-up: make health-check failure withdraw the announcement automatically.",

  keyEvidence: [
    "Failures are geographic — the same asset succeeds from one region and fails from another",
    "Edge error rate spiked while every origin service stayed healthy",
    "Origin request volume rose ~2.5x, exactly the traffic the edge normally absorbs",
    "Cache hit rate collapsed from 96% to near zero",
  ],
};
