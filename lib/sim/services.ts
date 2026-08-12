import type { ApiEndpointDef, MetricKey, ServiceDef, ServiceId } from "./types";

/**
 * The infrastructure of "Meridian Cloud", a fictional SaaS company.
 *
 * The dependency graph is the backbone of the whole simulation: it decides the
 * topology layout, how failures cascade, which services a scenario can plausibly
 * affect, and which symptoms reach customers.
 */

export const COMPANY = {
  name: "Meridian Cloud",
  domain: "meridiancloud.io",
  internalDomain: "internal.meridian.io",
  region: "us-east-1",
} as const;

const COMMON: MetricKey[] = ["latencyMs", "latencyP95", "latencyP99", "rps", "errorRate", "cpu", "memory"];

export const SERVICES: ServiceDef[] = [
  {
    id: "dns-resolver",
    name: "DNS Resolver",
    description:
      "Authoritative and recursive resolver for internal service discovery. Every service-to-service call resolves through it.",
    tier: "network",
    dependencies: [],
    owner: "Priya Raman",
    team: "Network Engineering",
    version: "coredns-1.11.3",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "ns1.internal.meridian.io",
    ip: "10.20.0.53",
    customerFacing: false,
    baseline: { latencyMs: 8, rps: 900, errorRate: 0.0002, cpu: 12, memory: 28 },
    slo: { latencyMs: 50, errorRate: 0.001, availability: 0.9999 },
    metrics: COMMON,
  },
  {
    id: "edge-cdn",
    name: "Edge CDN",
    description:
      "Global edge cache serving static assets and media. First hop for every end-user request.",
    tier: "edge",
    dependencies: ["dns-resolver", "load-balancer"],
    owner: "Marcus Webb",
    team: "Platform Infrastructure",
    version: "4.8.1",
    regions: ["global"],
    hostname: "cdn.meridiancloud.io",
    ip: "10.20.1.20",
    customerFacing: true,
    baseline: { latencyMs: 12, rps: 2400, errorRate: 0.0008, cpu: 22, memory: 34, cacheHitRate: 0.96 },
    slo: { latencyMs: 60, errorRate: 0.005, availability: 0.9995 },
    metrics: [...COMMON, "cacheHitRate"],
  },
  {
    id: "load-balancer",
    name: "Load Balancer",
    description: "Layer-7 load balancer and TLS termination point for all inbound traffic.",
    tier: "network",
    dependencies: ["web-frontend", "api-gateway"],
    owner: "Priya Raman",
    team: "Network Engineering",
    version: "envoy-1.31.0",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "lb-01.internal.meridian.io",
    ip: "10.20.0.10",
    customerFacing: true,
    baseline: { latencyMs: 4, rps: 1800, errorRate: 0.001, cpu: 18, memory: 30 },
    slo: { latencyMs: 25, errorRate: 0.005, availability: 0.9999 },
    metrics: COMMON,
  },
  {
    id: "web-frontend",
    name: "Web Frontend",
    description: "Server-rendered customer dashboard and marketing site.",
    tier: "app",
    dependencies: ["api-gateway"],
    softDependencies: ["edge-cdn"],
    owner: "Dana Whitfield",
    team: "Product Engineering",
    version: "7.2.4",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "web-01.internal.meridian.io",
    ip: "10.20.10.31",
    customerFacing: true,
    baseline: { latencyMs: 120, rps: 620, errorRate: 0.003, cpu: 34, memory: 48 },
    slo: { latencyMs: 800, errorRate: 0.01, availability: 0.999 },
    metrics: COMMON,
  },
  {
    id: "api-gateway",
    name: "API Gateway",
    description:
      "Public API entry point. Handles routing, rate limiting and request authentication for every downstream service.",
    tier: "app",
    dependencies: ["identity-service", "customer-api", "payment-service", "media-service"],
    softDependencies: ["redis-cache"],
    owner: "Dana Whitfield",
    team: "Platform Engineering",
    version: "5.1.0",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "api-01.internal.meridian.io",
    ip: "10.20.12.44",
    customerFacing: true,
    baseline: { latencyMs: 68, rps: 1450, errorRate: 0.004, cpu: 41, memory: 52 },
    slo: { latencyMs: 500, errorRate: 0.01, availability: 0.9995 },
    metrics: COMMON,
  },
  {
    id: "identity-service",
    name: "Identity Service",
    description: "Authentication, session issuance and token verification.",
    tier: "app",
    dependencies: ["primary-db"],
    softDependencies: ["redis-cache"],
    owner: "Sam Okonkwo",
    team: "Security Engineering",
    version: "3.9.2",
    regions: ["us-east-1"],
    hostname: "auth-01.internal.meridian.io",
    ip: "10.20.12.51",
    customerFacing: true,
    baseline: { latencyMs: 42, rps: 380, errorRate: 0.002, cpu: 28, memory: 44 },
    slo: { latencyMs: 300, errorRate: 0.005, availability: 0.9999 },
    metrics: COMMON,
  },
  {
    id: "customer-api",
    name: "Customer API",
    description: "Core business API for account, project and usage data.",
    tier: "app",
    dependencies: ["primary-db"],
    softDependencies: ["redis-cache"],
    owner: "Dana Whitfield",
    team: "Product Engineering",
    version: "6.4.1",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "cust-01.internal.meridian.io",
    ip: "10.20.12.60",
    customerFacing: true,
    baseline: { latencyMs: 86, rps: 540, errorRate: 0.005, cpu: 37, memory: 56 },
    slo: { latencyMs: 600, errorRate: 0.01, availability: 0.999 },
    metrics: COMMON,
  },
  {
    id: "payment-service",
    name: "Payment Service",
    description: "Checkout, subscription billing and third-party payment provider integration.",
    tier: "app",
    dependencies: ["primary-db"],
    softDependencies: ["message-queue"],
    owner: "Elena Vasquez",
    team: "Commerce",
    version: "2.7.8",
    regions: ["us-east-1"],
    hostname: "pay-01.internal.meridian.io",
    ip: "10.20.12.72",
    customerFacing: true,
    baseline: { latencyMs: 210, rps: 95, errorRate: 0.006, cpu: 24, memory: 41 },
    slo: { latencyMs: 1200, errorRate: 0.01, availability: 0.9995 },
    metrics: COMMON,
  },
  {
    id: "media-service",
    name: "Media Service",
    description: "Image and video transcoding, thumbnail generation and asset delivery.",
    tier: "app",
    dependencies: ["primary-db"],
    softDependencies: ["redis-cache", "message-queue"],
    owner: "Marcus Webb",
    team: "Product Engineering",
    version: "3.14.1",
    regions: ["us-east-1", "eu-west-1"],
    hostname: "media-01.internal.meridian.io",
    ip: "10.20.12.85",
    customerFacing: true,
    baseline: { latencyMs: 145, rps: 310, errorRate: 0.004, cpu: 45, memory: 62 },
    slo: { latencyMs: 900, errorRate: 0.01, availability: 0.999 },
    metrics: COMMON,
  },
  {
    id: "internal-api",
    name: "Internal API",
    description: "Back-office API used by support tooling and internal dashboards.",
    tier: "app",
    dependencies: ["primary-db", "message-queue"],
    owner: "Sam Okonkwo",
    team: "Platform Engineering",
    version: "1.8.3",
    regions: ["us-east-1"],
    hostname: "int-01.internal.meridian.io",
    ip: "10.20.12.90",
    customerFacing: false,
    baseline: { latencyMs: 55, rps: 180, errorRate: 0.003, cpu: 22, memory: 38 },
    slo: { latencyMs: 500, errorRate: 0.02, availability: 0.995 },
    metrics: COMMON,
  },
  {
    id: "notification-worker",
    name: "Notification Worker",
    description: "Consumes the event queue and delivers email, webhook and push notifications.",
    tier: "app",
    dependencies: ["message-queue"],
    softDependencies: ["primary-db"],
    owner: "Elena Vasquez",
    team: "Platform Engineering",
    version: "2.2.0",
    regions: ["us-east-1"],
    hostname: "worker-03.internal.meridian.io",
    ip: "10.20.20.14",
    customerFacing: false,
    baseline: { latencyMs: 320, rps: 60, errorRate: 0.008, cpu: 19, memory: 35, queueDepth: 40 },
    slo: { latencyMs: 2000, errorRate: 0.03, availability: 0.99 },
    metrics: [...COMMON, "queueDepth"],
  },
  {
    id: "message-queue",
    name: "Message Queue",
    description: "Durable event bus backing asynchronous work across the platform.",
    tier: "platform",
    dependencies: [],
    owner: "Sam Okonkwo",
    team: "Platform Infrastructure",
    version: "rabbitmq-3.13.4",
    regions: ["us-east-1"],
    hostname: "mq-01.internal.meridian.io",
    ip: "10.20.20.30",
    customerFacing: false,
    baseline: { latencyMs: 6, rps: 780, errorRate: 0.0005, cpu: 26, memory: 47, queueDepth: 120 },
    slo: { latencyMs: 50, errorRate: 0.005, availability: 0.9995 },
    metrics: [...COMMON, "queueDepth"],
  },
  {
    id: "redis-cache",
    name: "Redis Cache",
    description: "In-memory cache for sessions, rate-limit counters and hot query results.",
    tier: "data",
    dependencies: [],
    owner: "Priya Raman",
    team: "Platform Infrastructure",
    version: "redis-7.2.5",
    regions: ["us-east-1"],
    hostname: "cache-01.internal.meridian.io",
    ip: "10.20.30.11",
    customerFacing: false,
    baseline: { latencyMs: 1.2, rps: 4200, errorRate: 0.0003, cpu: 31, memory: 58, cacheHitRate: 0.94 },
    slo: { latencyMs: 10, errorRate: 0.002, availability: 0.9995 },
    metrics: [...COMMON, "cacheHitRate"],
  },
  {
    id: "primary-db",
    name: "Primary Database",
    description: "PostgreSQL 16 primary with one streaming replica. System of record for all tenant data.",
    tier: "data",
    dependencies: [],
    owner: "Priya Raman",
    team: "Data Platform",
    version: "postgres-16.3",
    regions: ["us-east-1"],
    hostname: "pg-primary-01.internal.meridian.io",
    ip: "10.20.30.21",
    customerFacing: false,
    baseline: {
      latencyMs: 12,
      rps: 1900,
      errorRate: 0.001,
      cpu: 38,
      memory: 61,
      connections: 84,
      connectionLimit: 200,
      diskUsage: 57,
    },
    slo: { latencyMs: 100, errorRate: 0.002, availability: 0.9999 },
    metrics: [...COMMON, "connections", "diskUsage"],
  },
  {
    id: "analytics-pipeline",
    name: "Analytics Pipeline",
    description: "Batch and streaming aggregation for product analytics and customer usage reports.",
    tier: "platform",
    dependencies: ["message-queue"],
    softDependencies: ["primary-db"],
    owner: "Elena Vasquez",
    team: "Data Platform",
    version: "1.4.7",
    regions: ["us-east-1"],
    hostname: "analytics-01.internal.meridian.io",
    ip: "10.20.40.12",
    customerFacing: false,
    baseline: { latencyMs: 480, rps: 40, errorRate: 0.01, cpu: 52, memory: 68, queueDepth: 300 },
    slo: { latencyMs: 5000, errorRate: 0.05, availability: 0.99 },
    metrics: [...COMMON, "queueDepth"],
  },
];

export const SERVICE_IDS = SERVICES.map((s) => s.id);

const SERVICE_MAP = new Map<ServiceId, ServiceDef>(SERVICES.map((s) => [s.id, s]));

export function getService(id: ServiceId): ServiceDef {
  const svc = SERVICE_MAP.get(id);
  if (!svc) throw new Error(`Unknown service: ${id}`);
  return svc;
}

export function serviceName(id: ServiceId): string {
  return SERVICE_MAP.get(id)?.name ?? id;
}

/** Services that call the given service. Used for blast-radius display. */
export function dependentsOf(id: ServiceId): ServiceId[] {
  return SERVICES.filter(
    (s) => s.dependencies.includes(id) || (s.softDependencies ?? []).includes(id),
  ).map((s) => s.id);
}

/**
 * Services ordered so that every service appears after all of its dependencies.
 * Health propagation walks this order once, so a cascade settles in one pass.
 */
export const TOPO_ORDER: ServiceId[] = (() => {
  const visited = new Set<ServiceId>();
  const order: ServiceId[] = [];
  const visit = (id: ServiceId, stack: Set<ServiceId>) => {
    if (visited.has(id) || stack.has(id)) return;
    stack.add(id);
    const def = SERVICE_MAP.get(id);
    if (def) {
      for (const dep of [...def.dependencies, ...(def.softDependencies ?? [])]) {
        visit(dep, stack);
      }
    }
    stack.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const s of SERVICES) visit(s.id, new Set());
  return order;
})();

// ---------------------------------------------------------------------------
// Topology layout — hand-placed so the request path reads top-to-bottom.
// Coordinates are in a 0..100 viewport space and scaled at render time.
// ---------------------------------------------------------------------------

export const TOPOLOGY_LAYOUT: Record<ServiceId, { x: number; y: number }> = {
  "dns-resolver": { x: 82, y: 8 },
  "edge-cdn": { x: 50, y: 8 },
  "load-balancer": { x: 50, y: 24 },
  "web-frontend": { x: 24, y: 40 },
  "api-gateway": { x: 60, y: 40 },
  "identity-service": { x: 14, y: 58 },
  "customer-api": { x: 36, y: 58 },
  "payment-service": { x: 58, y: 58 },
  "media-service": { x: 80, y: 58 },
  "internal-api": { x: 96, y: 40 },
  "notification-worker": { x: 88, y: 76 },
  "message-queue": { x: 72, y: 76 },
  "redis-cache": { x: 26, y: 76 },
  "primary-db": { x: 48, y: 92 },
  "analytics-pipeline": { x: 90, y: 92 },
};

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const API_ENDPOINTS: ApiEndpointDef[] = [
  {
    id: "get-status",
    method: "GET",
    path: "/api/status",
    service: "api-gateway",
    description: "Unauthenticated health and version probe. Polled by uptime monitors.",
    trafficShare: 0.08,
    samplePayload: `{\n  "status": "operational",\n  "version": "5.1.0",\n  "region": "us-east-1"\n}`,
  },
  {
    id: "post-login",
    method: "POST",
    path: "/api/login",
    service: "identity-service",
    description: "Exchanges credentials for a signed session token.",
    trafficShare: 0.12,
    samplePayload: `{\n  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",\n  "expiresIn": 3600,\n  "tokenType": "Bearer"\n}`,
  },
  {
    id: "get-users",
    method: "GET",
    path: "/api/users",
    service: "customer-api",
    description: "Paginated account directory for the authenticated tenant.",
    trafficShare: 0.24,
    samplePayload: `{\n  "data": [\n    { "id": "usr_8fa21", "email": "…", "role": "admin" }\n  ],\n  "page": 1,\n  "total": 1284\n}`,
  },
  {
    id: "get-projects",
    method: "GET",
    path: "/api/projects",
    service: "customer-api",
    description: "Project list with usage rollups for the dashboard.",
    trafficShare: 0.19,
    samplePayload: `{\n  "data": [\n    { "id": "prj_4c1", "name": "Atlas", "usage": 41203 }\n  ],\n  "total": 37\n}`,
  },
  {
    id: "get-media",
    method: "GET",
    path: "/api/media",
    service: "media-service",
    description: "Signed asset URLs and transcoding status.",
    trafficShare: 0.21,
    samplePayload: `{\n  "data": [\n    { "id": "med_91b", "url": "https://cdn.meridiancloud.io/…", "state": "ready" }\n  ]\n}`,
  },
  {
    id: "post-payments",
    method: "POST",
    path: "/api/payments",
    service: "payment-service",
    description: "Creates a charge against a stored payment method.",
    trafficShare: 0.06,
    samplePayload: `{\n  "id": "pay_7d20a",\n  "amount": 4900,\n  "currency": "usd",\n  "status": "succeeded"\n}`,
  },
  {
    id: "post-uploads",
    method: "POST",
    path: "/api/uploads",
    service: "media-service",
    description: "Multipart upload initiation for customer media.",
    trafficShare: 0.05,
    samplePayload: `{\n  "uploadId": "upl_2f8c",\n  "parts": 4,\n  "expiresAt": "2026-08-11T15:04:22Z"\n}`,
  },
  {
    id: "get-notifications",
    method: "GET",
    path: "/api/notifications",
    service: "internal-api",
    description: "Notification delivery log used by the support console.",
    trafficShare: 0.05,
    samplePayload: `{\n  "data": [\n    { "id": "ntf_11c", "channel": "email", "state": "delivered" }\n  ]\n}`,
  },
];

// ---------------------------------------------------------------------------
// Network fixtures
// ---------------------------------------------------------------------------

/**
 * Service-discovery names: `<service-id>.internal.meridian.io` resolves to that
 * service. Generated rather than listed so the names logs refer to are always
 * the names the diagnostic tools can resolve — an operator who reads a hostname
 * in a log line must be able to paste it straight into `dig`.
 */
const DISCOVERY_HOSTS: Record<string, ServiceId> = Object.fromEntries(
  SERVICES.map((s) => [`${s.id}.${COMPANY.internalDomain}`, s.id]),
);

export const NETWORK_HOSTS: Record<string, ServiceId> = {
  ...DISCOVERY_HOSTS,
  "api.internal": "api-gateway",
  "api-01.internal.meridian.io": "api-gateway",
  "auth.internal": "identity-service",
  "auth-01.internal.meridian.io": "identity-service",
  "db.internal": "primary-db",
  "pg-primary-01.internal.meridian.io": "primary-db",
  "cache.internal": "redis-cache",
  "cache-01.internal.meridian.io": "redis-cache",
  "media.internal": "media-service",
  "media-01.internal.meridian.io": "media-service",
  "pay.internal": "payment-service",
  "mq.internal": "message-queue",
  "web.internal": "web-frontend",
  "lb.internal": "load-balancer",
  "cdn.meridiancloud.io": "edge-cdn",
  "meridiancloud.io": "load-balancer",
  "www.meridiancloud.io": "load-balancer",
  "ns1.internal.meridian.io": "dns-resolver",
};

export const NETWORK_REGIONS = [
  { id: "us-east-1", label: "US East (Virginia)", primary: true },
  { id: "eu-west-1", label: "EU West (Ireland)", primary: false },
  { id: "ap-southeast-2", label: "AP Southeast (Sydney)", primary: false },
];

export const GATEWAY_IP = "10.20.0.1";
