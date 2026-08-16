import type { Scenario } from "../types";

/**
 * Memory Leak in Media Service (introduced by a deployment).
 *
 * The teaching point: this one is *slow*. Nothing breaks for the first minute —
 * memory just climbs on a single service. The blast radius is narrow and the
 * correlation that solves it is temporal: the climb starts exactly at a
 * deployment. Restarting relieves the symptom; only a rollback fixes the cause.
 */
export const memoryLeak: Scenario = {
  id: "memory-leak",
  title: "Memory Leak in Media Service",
  summary:
    "Memory on the media service climbs steadily after a release. Nothing fails at first — then everything image-related does.",
  difficulty: "advanced",
  severity: "SEV-2",
  affectedServices: ["media-service", "api-gateway", "edge-cdn"],
  expectedImpact:
    "A slow burn. Memory climbs for two to three minutes with no user impact, then garbage-collection thrash drives latency and 502s.",
  customerImpact:
    "Images and thumbnails progressively fail to load. Uploads time out. The rest of the product is unaffected.",
  declareAfterSeconds: 150,
  recoverySeconds: 50,

  impacts: [
    // The leak itself: a long, near-linear climb. This is the only early signal.
    { service: "media-service", metric: "memory", mode: "set", value: 97, rampSeconds: 210 },

    // GC pressure begins once memory is genuinely tight, not before.
    { service: "media-service", metric: "cpu", mode: "set", value: 93, delaySeconds: 110, rampSeconds: 110 },
    { service: "media-service", metric: "latencyMs", mode: "multiply", value: 9, delaySeconds: 95, rampSeconds: 120 },
    { service: "media-service", metric: "errorRate", mode: "set", value: 0.31, delaySeconds: 150, rampSeconds: 100 },
    { service: "media-service", metric: "rps", mode: "multiply", value: 0.7, delaySeconds: 190, rampSeconds: 80 },

    // Narrow blast radius: only the routes that go through media.
    { service: "api-gateway", metric: "latencyMs", mode: "multiply", value: 2.1, delaySeconds: 140, rampSeconds: 90 },
    { service: "api-gateway", metric: "errorRate", mode: "set", value: 0.07, delaySeconds: 165, rampSeconds: 90 },

    // The CDN starts missing on origin fetches for images.
    { service: "edge-cdn", metric: "errorRate", mode: "set", value: 0.05, delaySeconds: 180, rampSeconds: 90 },
    { service: "edge-cdn", metric: "cacheHitRate", mode: "set", value: 0.88, delaySeconds: 180, rampSeconds: 90 },

    // Transcoding work piles up behind the struggling service.
    { service: "message-queue", metric: "queueDepth", mode: "multiply", value: 4, delaySeconds: 170, rampSeconds: 90 },
  ],

  logTemplates: [
    {
      service: "media-service",
      level: "INFO",
      message: "heap usage {n}% after transcode batch; 412 objects retained",
      weight: 6,
      fields: { heapMb: 3820, retained: 412 },
    },
    {
      service: "media-service",
      level: "WARN",
      message: "GC pause 842ms (major); heap after collection barely reduced",
      weight: 7,
      minIntensity: 0.35,
      fields: { pauseMs: 842, collection: "major", freedMb: 18 },
    },
    {
      service: "media-service",
      level: "WARN",
      message: "thumbnail cache holding 21,480 buffers — eviction not keeping pace",
      weight: 5,
      minIntensity: 0.3,
      fields: { buffers: 21480, evicted: 96 },
    },
    {
      service: "media-service",
      level: "ERROR",
      message: "FATAL ERROR: JavaScript heap out of memory — allocation failed",
      weight: 6,
      minIntensity: 0.7,
      fields: { heapLimitMb: 4096 },
    },
    {
      service: "media-service",
      level: "CRITICAL",
      message: "worker 3 exited with OOMKilled; restarting (restart 4 of 5)",
      weight: 4,
      minIntensity: 0.75,
      fields: { exitCode: 137, restarts: 4 },
    },
    {
      service: "media-service",
      level: "ERROR",
      message: "POST /api/uploads aborted after 30000ms — no worker available",
      weight: 5,
      minIntensity: 0.6,
      fields: { statusCode: 504 },
    },
    {
      service: "api-gateway",
      level: "WARN",
      message: "upstream media-service returned 502 for GET /api/media",
      weight: 6,
      minIntensity: 0.55,
      fields: { statusCode: 502, upstream: "media-service" },
    },
    {
      service: "edge-cdn",
      level: "WARN",
      message: "origin fetch failed for /assets/thumb/{n}.webp — serving stale",
      weight: 4,
      minIntensity: 0.6,
    },
    {
      service: "message-queue",
      level: "WARN",
      message: "transcode queue depth {n}; consumer media-service acking slowly",
      weight: 3,
      minIntensity: 0.5,
    },
  ],

  ticketTemplates: [
    {
      subject: "Images aren't loading",
      body: "Thumbnails across my project gallery are showing as broken. Text and everything else works fine.",
      priority: "high",
      affectedService: "media-service",
      suggestedSteps: [
        "Check whether the failure is at the CDN or the origin",
        "Look at media service memory, not just latency",
      ],
    },
    {
      subject: "Upload fails at 100%",
      body: "I've tried uploading the same 40MB video four times. It reaches 100% then errors out with a timeout.",
      priority: "high",
      affectedService: "media-service",
      suggestedSteps: ["Check for worker restarts and OOM kills", "Review the last deployment to this service"],
    },
    {
      subject: "Gallery page very slow to load",
      body: "The page itself appears but images trickle in over about 30 seconds, and some never appear.",
      priority: "normal",
      affectedService: "media-service",
      suggestedSteps: ["Correlate the slowdown with the media service deployment timeline"],
    },
    {
      subject: "Some product photos missing on our storefront",
      body: "Roughly a third of our images are gone. They were all fine this morning.",
      priority: "normal",
      affectedService: "edge-cdn",
      suggestedSteps: ["Check CDN origin error rate and cache hit ratio"],
    },
  ],

  diagnosisOptions: [
    { id: "memory-leak", label: "Memory leak introduced by a deployment", feedback: "" },
    {
      id: "database-overload",
      label: "Database connection exhaustion",
      feedback:
        "The database is idle by comparison — connections and CPU are at baseline, and services that talk to it are all healthy. Only one service is in trouble here.",
    },
    {
      id: "dns-failure",
      label: "DNS resolution failure",
      feedback:
        "Resolution is working normally. If DNS were failing you would see errors across every service, not just the one serving images.",
    },
    {
      id: "cdn-issue",
      label: "CDN regional outage",
      feedback:
        "The CDN is failing on origin fetches, which means it is asking the origin and not getting an answer. Follow the request one hop further back.",
    },
    {
      id: "traffic-spike",
      label: "Organic traffic spike overwhelming capacity",
      feedback:
        "Request rate has not risen — check the throughput chart. In fact it is falling as the service sheds load. Resource use climbed without any increase in work.",
    },
    {
      id: "network-congestion",
      label: "Network congestion / packet loss",
      feedback:
        "The network path to the media service is clean: no loss, normal round-trip times. The delay is inside the process.",
    },
  ],
  correctDiagnosisId: "memory-leak",

  remediationOptions: [
    {
      id: "rollback-media-service",
      label: "Roll back Media Service to v3.14.1",
      description: "Redeploy the previous release, which does not contain the leaking code path.",
      durationSeconds: 30,
      ineffectiveNote: "",
    },
    {
      id: "restart-media-service",
      label: "Restart Media Service",
      description: "Rolling restart to reclaim heap.",
      durationSeconds: 15,
      ineffectiveNote:
        "Memory dropped to normal and then began climbing again at exactly the same rate. A restart buys minutes; it does not remove the leak.",
    },
    {
      id: "scale-media-service",
      label: "Scale up Media Service",
      description: "Double the replica count and raise the per-pod memory limit.",
      durationSeconds: 25,
      ineffectiveNote:
        "More replicas each leak at the same rate — this delays the failure rather than preventing it, and doubles the memory bill.",
    },
    {
      id: "purge-cdn-cache",
      label: "Purge CDN cache",
      description: "Invalidate all cached image objects.",
      durationSeconds: 20,
      ineffectiveNote:
        "This made it worse: purging the cache sent every image request to an origin that was already failing.",
    },
    {
      id: "increase-db-connections",
      label: "Increase database connection pool",
      description: "Raise max_connections on the primary.",
      durationSeconds: 15,
      ineffectiveNote: "The database was never involved. No change.",
    },
    {
      id: "disable-thumbnail-flag",
      label: "Disable the new-thumbnail-pipeline flag",
      description: "Turn off the feature flag guarding the new transcoding path.",
      durationSeconds: 10,
      ineffectiveNote:
        "The flag was already at 100% rollout and the leak is in the shared buffer pool, not behind the flag. Memory kept climbing.",
    },
  ],
  requiredRemediationIds: ["rollback-media-service"],

  rootCause:
    "Media Service v3.14.2 introduced a thumbnail buffer pool that retained a reference to every decoded frame in a module-level cache. The eviction policy only ran on cache writes, so under sustained read traffic entries were never released. Heap grew until major garbage collections could no longer reclaim space, at which point GC pauses dominated the event loop and workers began being OOM-killed.",
  resolution:
    "Media Service was rolled back to v3.14.1. Memory returned to baseline within one collection cycle and the transcode backlog drained over the following minute. Follow-up: add a heap-growth alert and a memory regression test to the release pipeline.",

  hints: [
    {
      title: "Only one service is actually in trouble",
      body: "Unlike a widespread outage, the blast radius here is tiny. Find the single service whose numbers are drifting, and note which product features depend on it.",
    },
    {
      title: "Resource use is climbing without more work",
      body: "Compare two charts for that service: how much traffic it is handling, and how much memory it is using. Traffic is flat or falling. Memory is not. Something is accumulating that should be getting cleaned up.",
    },
    {
      title: "Ask what changed just before it started",
      body: "This began at a specific moment rather than building gradually with load. Open QA Lab and line up the deployment history against when memory started climbing.",
    },
  ],

  keyEvidence: [
    "Memory climbing steadily on media-service while every other service is flat",
    "Request rate did not rise — resource use grew without extra work",
    "The climb begins at the media-service v3.14.2 deployment timestamp",
    "Logs show major GC pauses reclaiming almost nothing, then OOMKilled workers",
    "Blast radius is confined to image and upload routes",
  ],
};
