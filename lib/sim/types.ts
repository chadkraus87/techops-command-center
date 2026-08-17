/**
 * Core domain types for the TechOps simulation.
 *
 * Everything in the application derives from these. The simulation engine owns
 * the metric layer; service health, alerts, logs, tickets and topology state are
 * all *derived* from metrics rather than set independently — that is what keeps
 * an incident's symptoms coherent across every view.
 */

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export type ServiceId =
  | "edge-cdn"
  | "dns-resolver"
  | "load-balancer"
  | "web-frontend"
  | "api-gateway"
  | "identity-service"
  | "customer-api"
  | "payment-service"
  | "media-service"
  | "internal-api"
  | "notification-worker"
  | "message-queue"
  | "redis-cache"
  | "primary-db"
  | "analytics-pipeline";

/** Where a service sits in the request path. Drives topology layout. */
export type ServiceTier = "edge" | "network" | "app" | "platform" | "data";

export type HealthStatus = "healthy" | "degraded" | "critical" | "offline";

export interface ServiceDef {
  id: ServiceId;
  name: string;
  /** Short description shown in detail panels. */
  description: string;
  tier: ServiceTier;
  /** Services this one calls. Used for topology edges and health propagation. */
  dependencies: ServiceId[];
  /**
   * A hard dependency failing takes this service down; a soft one degrades it.
   * Modelling this distinction is what makes a Redis outage look different from
   * a Postgres outage.
   */
  softDependencies?: ServiceId[];
  owner: string;
  team: string;
  version: string;
  regions: string[];
  hostname: string;
  ip: string;
  /** True if end users touch this service directly — drives ticket generation. */
  customerFacing: boolean;
  baseline: ServiceBaseline;
  slo: ServiceSlo;
  /** Metric channels that are meaningful for this service. */
  metrics: MetricKey[];
}

export interface ServiceBaseline {
  latencyMs: number;
  rps: number;
  errorRate: number; // 0..1
  cpu: number; // 0..100
  memory: number; // 0..100
  /** Optional channels, present only where they make sense. */
  connections?: number;
  connectionLimit?: number;
  cacheHitRate?: number; // 0..1
  queueDepth?: number;
  diskUsage?: number; // 0..100
  packetLoss?: number; // 0..1
}

export interface ServiceSlo {
  /** Latency at which the service is considered degraded. */
  latencyMs: number;
  /** Error rate at which the service is considered degraded. */
  errorRate: number;
  /** Monthly availability target, e.g. 0.999. */
  availability: number;
}

export type MetricKey =
  | "latencyMs"
  | "latencyP95"
  | "latencyP99"
  | "rps"
  | "errorRate"
  | "cpu"
  | "memory"
  | "connections"
  | "cacheHitRate"
  | "queueDepth"
  | "diskUsage"
  | "packetLoss";

/** A full metric reading for one service at one instant. */
export type MetricSnapshot = Partial<Record<MetricKey, number>>;

export interface ServiceRuntime {
  id: ServiceId;
  status: HealthStatus;
  metrics: MetricSnapshot;
  /** False when the service cannot be reached at all (DNS/network failures). */
  reachable: boolean;
  /** Seconds of simulated uptime since the environment was last reset. */
  uptimeSeconds: number;
  /** Seconds spent in a non-healthy state — feeds the availability figure. */
  downtimeSeconds: number;
  /** Human-readable reason for the current status, shown in detail panels. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface LogEntry {
  id: string;
  /** Simulated wall-clock time, ms since epoch. */
  timestamp: number;
  level: LogLevel;
  service: ServiceId;
  message: string;
  requestId: string;
  host: string;
  environment: "production" | "staging";
  /** Set when the line was produced as a symptom of an incident. */
  incidentId?: string;
  /** Structured fields shown when a line is expanded. */
  fields?: Record<string, LogFieldValue>;
}

/** Values a structured log field may hold. */
export type LogFieldValue = string | number | boolean;

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertRule {
  id: string;
  service: ServiceId;
  metric: MetricKey;
  comparator: "gt" | "lt";
  threshold: number;
  severity: AlertSeverity;
  title: string;
  /** Seconds the condition must hold before the alert fires. */
  forSeconds: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  service: ServiceId;
  severity: AlertSeverity;
  title: string;
  /** Rendered description including the observed value. */
  detail: string;
  metric: MetricKey;
  value: number;
  threshold: number;
  firedAt: number;
  resolvedAt: number | null;
  acknowledged: boolean;
  incidentId?: string;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type IncidentSeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export interface TimelineEvent {
  id: string;
  timestamp: number;
  kind:
    | "alert"
    | "detection"
    | "declaration"
    | "investigation"
    | "diagnosis"
    | "remediation"
    | "recovery"
    | "resolution"
    | "note";
  message: string;
  /** Optional actor, e.g. "Auto-detection" or "You". */
  actor?: string;
}

export interface Incident {
  id: string;
  scenarioId: ScenarioId;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt: number | null;
  /**
   * The tick the incident began on. Together with `startedAt` this is enough to
   * reconstruct the exact telemetry at any moment of the run, because the
   * baseline model is a pure function of tick and clock.
   */
  startedAtTick: number;
  /**
   * Elapsed seconds at which recovery began, or null if it never did. The only
   * other fact replay needs — impact unwind is a pure function of it.
   */
  recoveryStartedAtElapsed: number | null;
  affectedServices: ServiceId[];
  customerImpact: string;
  timeline: TimelineEvent[];
  /** Root cause, revealed only once correctly diagnosed or the run is over. */
  rootCause: string;
  resolution: string;
  /** Populated by the investigation workflow. */
  investigation: InvestigationState;
}

export interface InvestigationState {
  /** Diagnosis options the user has submitted, in order. */
  diagnosisAttempts: string[];
  diagnosedAt: number | null;
  correctDiagnosis: boolean;
  /** Remediation action ids applied, in order. */
  actionsTaken: string[];
  /** Ids of evidence the user actually looked at, for scoring. */
  evidenceViewed: string[];
  /** Remediation steps still required before recovery begins. */
  remainingSteps: string[];
  /** How many progressive hints have been revealed. Costs score. */
  hintsRevealed: number;
}

/**
 * A progressive hint.
 *
 * Three per scenario, deliberately ordered so that taking one still leaves
 * something to work out. The first says where to look, the second says what is
 * notable there, and only the third names the mechanism — never the exact
 * diagnosis label, so the final judgement always belongs to the operator.
 */
export interface ScenarioHint {
  /** Plain-language heading, readable without ops background. */
  title: string;
  /** The hint itself. */
  body: string;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export type TicketPriority = "urgent" | "high" | "normal" | "low";
export type TicketStatus = "new" | "open" | "pending" | "resolved";

export interface SupportTicket {
  id: string;
  customer: string;
  company: string;
  subject: string;
  body: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: number;
  affectedService: ServiceId;
  incidentId?: string;
  environment: string;
  /** Troubleshooting hints an experienced agent would attach. */
  suggestedSteps: string[];
  internalNotes: string[];
}

// ---------------------------------------------------------------------------
// API monitor
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiEndpointDef {
  id: string;
  method: HttpMethod;
  path: string;
  /** The service that ultimately serves this route. */
  service: ServiceId;
  description: string;
  /** Share of gateway traffic, 0..1. */
  trafficShare: number;
  samplePayload: string;
}

export interface ApiEndpointRuntime {
  id: string;
  requestsPerMin: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  status: HealthStatus;
}

export interface ApiRequestSample {
  id: string;
  endpointId: string;
  timestamp: number;
  statusCode: number;
  durationMs: number;
  requestId: string;
  region: string;
  /** Error body when the call failed. */
  responseBody: string;
}

// ---------------------------------------------------------------------------
// QA / deployments
// ---------------------------------------------------------------------------

export type DeploymentStatus = "succeeded" | "failed" | "rolled-back" | "running";

export interface Deployment {
  id: string;
  service: ServiceId;
  version: string;
  deployedAt: number;
  status: DeploymentStatus;
  author: string;
  testsPassed: number;
  testsFailed: number;
  coverage: number;
  regressionRisk: "low" | "medium" | "high";
  changelog: string[];
  /** Set when this deployment is what caused an incident. */
  causedIncidentId?: string;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rollout: number; // 0..100
  owner: string;
}

export interface KnownBug {
  id: string;
  title: string;
  severity: "P1" | "P2" | "P3";
  service: ServiceId;
  status: "open" | "in-progress" | "fixed";
  reportedAt: number;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export interface NetworkNode {
  id: string;
  label: string;
  ip: string;
  kind: "gateway" | "dns" | "service" | "edge" | "database";
  /** Service whose health governs this node, when applicable. */
  service?: ServiceId;
  hops: number;
}

export type NetworkToolKind = "ping" | "traceroute" | "dig" | "port" | "curl";

export interface TerminalLine {
  id: string;
  text: string;
  tone: "input" | "output" | "ok" | "warn" | "error" | "muted";
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioId =
  | "dns-failure"
  | "database-overload"
  | "memory-leak"
  | "redis-failure"
  | "cdn-outage"
  | "tls-expiry"
  | "packet-loss"
  | "payment-provider-outage";

export type ImpactMode = "multiply" | "add" | "set";

/** One metric consequence of a scenario. */
export interface Impact {
  service: ServiceId;
  metric: MetricKey;
  mode: ImpactMode;
  /** Target value at full intensity. */
  value: number;
  /** Seconds after incident start before this effect begins. */
  delaySeconds?: number;
  /** Seconds taken to reach full effect once started. */
  rampSeconds?: number;
  /** Seconds taken to unwind after remediation. Defaults to rampSeconds. */
  recoverySeconds?: number;
}

export interface DiagnosisOption {
  id: string;
  label: string;
  /** Shown when the user picks this and it is wrong — a nudge, not the answer. */
  feedback: string;
}

export interface RemediationOption {
  id: string;
  label: string;
  description: string;
  /** Realistic time cost in simulated seconds. */
  durationSeconds: number;
  /** Consequence text shown when this action is applied but not required. */
  ineffectiveNote: string;
}

export interface ScenarioLogTemplate {
  service: ServiceId;
  level: LogLevel;
  /** Tokens: {requestId} {host} {ms} {n} */
  message: string;
  /** Relative frequency while the incident is active. */
  weight: number;
  fields?: Record<string, LogFieldValue>;
  /** Only emit once intensity passes this threshold (0..1). */
  minIntensity?: number;
}

export interface ScenarioTicketTemplate {
  subject: string;
  body: string;
  priority: TicketPriority;
  affectedService: ServiceId;
  suggestedSteps: string[];
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** One-line pitch shown on the scenario card. */
  summary: string;
  difficulty: "starter" | "intermediate" | "advanced";
  severity: IncidentSeverity;
  /** Services listed as affected on the incident record. */
  affectedServices: ServiceId[];
  expectedImpact: string;
  customerImpact: string;
  /** Seconds from trigger until the incident is auto-declared. */
  declareAfterSeconds: number;
  impacts: Impact[];
  /** Services that become entirely unreachable, with an optional delay. */
  unreachable?: { service: ServiceId; delaySeconds?: number }[];
  logTemplates: ScenarioLogTemplate[];
  ticketTemplates: ScenarioTicketTemplate[];
  diagnosisOptions: DiagnosisOption[];
  correctDiagnosisId: string;
  remediationOptions: RemediationOption[];
  /** Ordered ids that must all be applied before recovery starts. */
  requiredRemediationIds: string[];
  rootCause: string;
  resolution: string;
  /** Post-mortem hints surfaced on the score screen. */
  keyEvidence: string[];
  /** Progressive in-incident guidance, revealed one at a time in guided mode. */
  hints: ScenarioHint[];
  /** Seconds for metrics to return to baseline after remediation completes. */
  recoverySeconds: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type Rank =
  | "Junior Technician"
  | "Support Specialist"
  | "Systems Analyst"
  | "Senior Troubleshooter"
  | "Incident Commander"
  | "Site Reliability Expert";

export interface ScoreBreakdown {
  diagnosisPoints: number;
  speedPoints: number;
  investigationPoints: number;
  remediationPoints: number;
  penalties: number;
  total: number;
  rank: Rank;
  /** Simulated seconds from incident start to correct diagnosis. */
  timeToDiagnosisSeconds: number | null;
  /** Simulated seconds from incident start to full resolution. */
  timeToResolutionSeconds: number | null;
  diagnosisAttempts: number;
  unnecessaryActions: string[];
  evidenceViewedCount: number;
  /** Hints taken, and what they cost — reported so the score is explainable. */
  hintsRevealed: number;
  hintPenalty: number;
}

export interface StoredResult {
  scenarioId: ScenarioId;
  score: number;
  rank: Rank;
  completedAt: number;
  timeToResolutionSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

export type IncidentPhase =
  | "idle"
  | "ramping"
  | "sustained"
  | "remediating"
  | "recovering"
  | "resolved";

export interface ActiveScenarioState {
  scenarioId: ScenarioId;
  incidentId: string;
  startedAt: number;
  /** Simulated seconds since the scenario began. */
  elapsed: number;
  phase: IncidentPhase;
  /** 0..1 — how much of the scenario's impact is currently applied. */
  intensity: number;
  /** Simulated seconds since remediation completed, drives recovery. */
  recoveryElapsed: number;
  /** Set while a remediation action is in flight. */
  pendingAction: { id: string; remainingSeconds: number } | null;
}

export type SimSpeed = 1 | 2 | 4;

export interface SimState {
  /** Simulated wall-clock, ms since epoch. */
  clock: number;
  /** Simulated seconds since the environment started. */
  elapsed: number;
  running: boolean;
  speed: SimSpeed;
  /** Deterministic RNG cursor — the same tick count always yields the same data. */
  tickCount: number;
  services: Record<ServiceId, ServiceRuntime>;
  logs: LogEntry[];
  alerts: Alert[];
  tickets: SupportTicket[];
  incidents: Incident[];
  deployments: Deployment[];
  requests: ApiRequestSample[];
  active: ActiveScenarioState | null;
  /** Rolling per-series history, keyed `${serviceId}:${metric}`. */
  history: Record<string, number[]>;
  /** Fleet-wide aggregates, same cadence as history. */
  globalHistory: {
    rps: number[];
    latency: number[];
    errorRate: number[];
    tickets: number[];
  };
  /** Alert rule evaluation windows — seconds each condition has held. */
  ruleHoldSeconds: Record<string, number>;
  /** A pending deployment that will cause an incident once it bakes. */
  scheduledFailure: { scenarioId: ScenarioId; inSeconds: number } | null;
}
