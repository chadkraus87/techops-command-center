import { noiseAt } from "./random";
import { GATEWAY_IP, getService, NETWORK_HOSTS, SERVICES } from "./services";
import type { ServiceId, SimState, TerminalLine } from "./types";

/**
 * Simulated network diagnostics.
 *
 * SECURITY: none of these functions perform real network activity. There is no
 * socket, no fetch, no shell. Every command is answered from the in-memory
 * simulation state, so the deployed application cannot be used to probe, scan
 * or reach any real host — which is exactly why a public demo can safely offer
 * a terminal at all.
 *
 * Diagnostically, the interesting property is that these tools disagree with
 * each other in useful ways: during a DNS incident `ping` by IP succeeds while
 * `dig` fails, and that contradiction is the evidence that solves the scenario.
 */

let lineCounter = 0;

function line(text: string, tone: TerminalLine["tone"] = "output"): TerminalLine {
  return { id: `t-${lineCounter++}`, text, tone };
}

const IP_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Map a hostname or IP to the service that answers for it. */
export function resolveTarget(target: string): { service: ServiceId; ip: string } | null {
  const normalised = target.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];

  if (IP_PATTERN.test(normalised)) {
    const svc = SERVICES.find((s) => s.ip === normalised);
    return svc ? { service: svc.id, ip: svc.ip } : null;
  }

  const mapped = NETWORK_HOSTS[normalised];
  if (mapped) return { service: mapped, ip: getService(mapped).ip };

  const byHostname = SERVICES.find((s) => s.hostname.toLowerCase() === normalised);
  return byHostname ? { service: byHostname.id, ip: byHostname.ip } : null;
}

/** True when the resolver is too unhealthy to answer queries. */
export function dnsIsBroken(state: SimState): boolean {
  const resolver = state.services["dns-resolver"];
  if (!resolver) return false;
  return !resolver.reachable || (resolver.metrics.errorRate ?? 0) > 0.5;
}

interface ProbeOutcome {
  latencyMs: number;
  lost: boolean;
  refused: boolean;
}

function probe(state: SimState, serviceId: ServiceId, attempt: number, tick: number): ProbeOutcome {
  const runtime = state.services[serviceId];
  const loss = runtime?.metrics.packetLoss ?? 0;
  const errorRate = runtime?.metrics.errorRate ?? 0;
  const roll = noiseAt(`probe:${serviceId}:${attempt}`, tick);

  // Network-layer latency is much lower than application latency — a ping
  // measures the wire, not the request handler.
  const base = 0.4 + (runtime?.metrics.latencyMs ?? 10) * 0.05;
  const jitter = loss > 0 ? roll * 40 * loss : roll * 1.6;

  return {
    latencyMs: Math.max(0.2, base + jitter),
    lost: roll < loss,
    refused: !runtime?.reachable || errorRate > 0.85,
  };
}

// ---------------------------------------------------------------------------
// ping
// ---------------------------------------------------------------------------

export function runPing(state: SimState, target: string, tick: number): TerminalLine[] {
  const isIp = IP_PATTERN.test(target.trim());

  if (!isIp && dnsIsBroken(state)) {
    return [
      line(`ping: cannot resolve ${target}: Unknown host`, "error"),
      line("hint: the host may still be reachable by IP address", "muted"),
    ];
  }

  const resolved = resolveTarget(target);
  if (!resolved) {
    return [line(`ping: cannot resolve ${target}: Name or service not known`, "error")];
  }

  const def = getService(resolved.service);
  const out: TerminalLine[] = [line(`PING ${target} (${resolved.ip}) 56(84) bytes of data.`)];

  const count = 5;
  let received = 0;
  const times: number[] = [];

  for (let i = 0; i < count; i++) {
    const result = probe(state, resolved.service, i, tick);
    if (result.refused) {
      out.push(line(`From ${GATEWAY_IP} icmp_seq=${i + 1} Destination Host Unreachable`, "error"));
    } else if (result.lost) {
      out.push(line(`Request timeout for icmp_seq ${i + 1}`, "warn"));
    } else {
      received++;
      times.push(result.latencyMs);
      out.push(
        line(
          `64 bytes from ${resolved.ip}: icmp_seq=${i + 1} ttl=63 time=${result.latencyMs.toFixed(1)} ms`,
          "ok",
        ),
      );
    }
  }

  const lossPct = ((count - received) / count) * 100;
  out.push(line(""));
  out.push(line(`--- ${def.hostname} ping statistics ---`));
  out.push(
    line(
      `${count} packets transmitted, ${received} received, ${lossPct.toFixed(0)}% packet loss`,
      lossPct > 5 ? "error" : "output",
    ),
  );
  if (times.length > 0) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const mdev = Math.sqrt(times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length);
    out.push(
      line(
        `rtt min/avg/max/mdev = ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)}/${mdev.toFixed(1)} ms`,
        mdev > 10 ? "warn" : "output",
      ),
    );
    if (mdev > 10) {
      out.push(line("note: high deviation indicates jitter or retransmission", "warn"));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// dig
// ---------------------------------------------------------------------------

export function runDig(state: SimState, target: string, tick: number): TerminalLine[] {
  const out: TerminalLine[] = [
    line(`; <<>> DiG 9.18.28 <<>> ${target}`, "muted"),
    line(";; global options: +cmd", "muted"),
  ];

  if (dnsIsBroken(state)) {
    out.push(line(";; Got answer:", "muted"));
    out.push(
      line(";; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 41823", "error"),
    );
    out.push(line(";; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 0", "muted"));
    out.push(line(""));
    out.push(line(";; QUESTION SECTION:"));
    out.push(line(`;${target}.\t\t\tIN\tA`));
    out.push(line(""));
    out.push(line(";; Query time: 5002 msec", "warn"));
    out.push(line(";; SERVER: 10.20.0.53#53(10.20.0.53) (UDP)", "muted"));
    out.push(line(";; WHEN: — no valid answer received", "error"));
    return out;
  }

  const resolved = resolveTarget(target);
  if (!resolved) {
    out.push(line(";; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 41824", "warn"));
    out.push(line(`;; no such name: ${target}`, "warn"));
    return out;
  }

  const queryTime = Math.round(1 + noiseAt(`dig:${target}`, tick) * 6);
  out.push(line(";; Got answer:", "muted"));
  out.push(line(";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 41823", "ok"));
  out.push(line(""));
  out.push(line(";; QUESTION SECTION:"));
  out.push(line(`;${target}.\t\t\tIN\tA`));
  out.push(line(""));
  out.push(line(";; ANSWER SECTION:", "ok"));
  out.push(line(`${target}.\t\t60\tIN\tA\t${resolved.ip}`, "ok"));
  out.push(line(""));
  out.push(line(`;; Query time: ${queryTime} msec`));
  out.push(line(";; SERVER: 10.20.0.53#53(10.20.0.53) (UDP)", "muted"));
  return out;
}

// ---------------------------------------------------------------------------
// traceroute
// ---------------------------------------------------------------------------

export function runTraceroute(state: SimState, target: string, tick: number): TerminalLine[] {
  const isIp = IP_PATTERN.test(target.trim());
  if (!isIp && dnsIsBroken(state)) {
    return [line(`traceroute: unknown host ${target}`, "error")];
  }

  const resolved = resolveTarget(target);
  if (!resolved) return [line(`traceroute: unknown host ${target}`, "error")];

  const def = getService(resolved.service);
  const subnet = resolved.ip.split(".").slice(0, 3).join(".");
  const hops = [
    { label: "edge-rtr-01.internal.meridian.io", ip: GATEWAY_IP },
    { label: `core-sw-02.internal.meridian.io`, ip: "10.20.0.2" },
    { label: `${subnet}.1`, ip: `${subnet}.1` },
    { label: def.hostname, ip: resolved.ip },
  ];

  const out: TerminalLine[] = [
    line(`traceroute to ${target} (${resolved.ip}), 30 hops max, 60 byte packets`),
  ];

  const loss = state.services[resolved.service]?.metrics.packetLoss ?? 0;

  hops.forEach((hop, index) => {
    const isFinal = index === hops.length - 1;
    // Loss on the data-tier link shows up on the last two hops, which is the
    // signal that localises a lossy link to a segment.
    const hopLoss = index >= hops.length - 2 ? loss : 0;
    const samples: string[] = [];
    let anyLost = false;

    for (let probeIndex = 0; probeIndex < 3; probeIndex++) {
      const roll = noiseAt(`trace:${index}:${probeIndex}`, tick);
      if (roll < hopLoss) {
        samples.push("*");
        anyLost = true;
      } else {
        const latency = 0.3 + index * 0.9 + roll * (1 + hopLoss * 40);
        samples.push(`${latency.toFixed(3)} ms`);
      }
    }

    const unreachable = isFinal && !state.services[resolved.service]?.reachable;
    if (unreachable) {
      out.push(line(` ${index + 1}  * * *`, "error"));
    } else {
      out.push(
        line(` ${index + 1}  ${hop.label} (${hop.ip})  ${samples.join("  ")}`, anyLost ? "warn" : "output"),
      );
    }
  });

  if (loss > 0.03) {
    out.push(line(""));
    out.push(line(`note: loss concentrated on the final hops toward ${subnet}.0/24`, "warn"));
  }

  return out;
}

// ---------------------------------------------------------------------------
// port test
// ---------------------------------------------------------------------------

const DEFAULT_PORTS: Partial<Record<ServiceId, number>> = {
  "primary-db": 5432,
  "redis-cache": 6379,
  "message-queue": 5672,
  "dns-resolver": 53,
  "api-gateway": 8443,
  "identity-service": 8443,
  "customer-api": 8443,
  "media-service": 8443,
  "payment-service": 8443,
  "load-balancer": 443,
  "web-frontend": 3000,
  "edge-cdn": 443,
  "internal-api": 8080,
  "notification-worker": 8080,
  "analytics-pipeline": 8080,
};

export function runPortTest(
  state: SimState,
  target: string,
  port: number | undefined,
  tick: number,
): TerminalLine[] {
  const isIp = IP_PATTERN.test(target.trim());
  if (!isIp && dnsIsBroken(state)) {
    return [line(`nc: getaddrinfo for host "${target}" port ${port ?? 443}: Name or service not known`, "error")];
  }

  const resolved = resolveTarget(target);
  if (!resolved) return [line(`nc: could not resolve ${target}`, "error")];

  const resolvedPort = port ?? DEFAULT_PORTS[resolved.service] ?? 443;
  const runtime = state.services[resolved.service];
  const errorRate = runtime?.metrics.errorRate ?? 0;
  const result = probe(state, resolved.service, 0, tick);

  const out: TerminalLine[] = [];

  if (!runtime?.reachable) {
    out.push(line(`nc: connect to ${resolved.ip} port ${resolvedPort} (tcp) failed: No route to host`, "error"));
    return out;
  }

  if (errorRate > 0.85) {
    out.push(line(`nc: connect to ${resolved.ip} port ${resolvedPort} (tcp) failed: Connection refused`, "error"));
    return out;
  }

  out.push(line(`Connection to ${resolved.ip} ${resolvedPort} port [tcp/*] succeeded!`, "ok"));
  out.push(line(`TCP handshake completed in ${result.latencyMs.toFixed(1)} ms`, "muted"));

  // A TLS-terminating port during a certificate incident connects and then
  // fails validation — which is precisely how that failure presents in reality.
  const tlsPorts = [443, 8443, 5432];
  if (tlsPorts.includes(resolvedPort) && errorRate > 0.6) {
    out.push(line("TLS handshake failed: certificate verify failed (certificate has expired)", "error"));
  }

  return out;
}

// ---------------------------------------------------------------------------
// curl
// ---------------------------------------------------------------------------

export function runCurl(state: SimState, target: string, tick: number): TerminalLine[] {
  const isIp = IP_PATTERN.test(target.trim().replace(/^https?:\/\//, "").split("/")[0]);
  if (!isIp && dnsIsBroken(state)) {
    return [
      line(`curl: (6) Could not resolve host: ${target.replace(/^https?:\/\//, "").split("/")[0]}`, "error"),
    ];
  }

  const resolved = resolveTarget(target);
  if (!resolved) return [line(`curl: (6) Could not resolve host: ${target}`, "error")];

  const runtime = state.services[resolved.service];
  const errorRate = runtime?.metrics.errorRate ?? 0;
  const latency = runtime?.metrics.latencyMs ?? 50;
  const roll = noiseAt(`curl:${target}`, tick);

  if (!runtime?.reachable) {
    return [line(`curl: (7) Failed to connect to ${resolved.ip}: No route to host`, "error")];
  }

  if (roll < errorRate) {
    if (latency > 5000) {
      return [line(`curl: (28) Operation timed out after ${Math.round(latency)} milliseconds`, "error")];
    }
    const status = errorRate > 0.6 ? 503 : 500;
    return [
      line(`HTTP/2 ${status}`, "error"),
      line("content-type: application/json", "muted"),
      line(`x-request-id: req_${Math.floor(roll * 1e12).toString(16)}`, "muted"),
      line(""),
      line(`{"error":"${status === 503 ? "service_unavailable" : "internal_error"}"}`, "error"),
      line(""),
      line(`Total time: ${(latency / 1000).toFixed(3)}s`, "muted"),
    ];
  }

  return [
    line("HTTP/2 200", "ok"),
    line("content-type: application/json", "muted"),
    line(`x-request-id: req_${Math.floor(roll * 1e12).toString(16)}`, "muted"),
    line(`x-served-by: ${getService(resolved.service).hostname}`, "muted"),
    line(""),
    line(`{"status":"ok","service":"${resolved.service}"}`, "ok"),
    line(""),
    line(`Total time: ${(latency / 1000).toFixed(3)}s`, "muted"),
  ];
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

export const AVAILABLE_COMMANDS = [
  { command: "ping <host>", description: "ICMP echo with loss and jitter statistics" },
  { command: "dig <host>", description: "DNS lookup against the internal resolver" },
  { command: "traceroute <host>", description: "Hop-by-hop path with per-hop latency" },
  { command: "nc <host> [port]", description: "TCP port reachability and TLS handshake test" },
  { command: "curl <host>", description: "HTTP request showing status and timing" },
  { command: "status", description: "Health summary for every host" },
  { command: "hosts", description: "List known internal hostnames" },
  { command: "help", description: "Show this list" },
  { command: "clear", description: "Clear the terminal" },
];

export function runStatus(state: SimState): TerminalLine[] {
  const out: TerminalLine[] = [line("HOST                                    IP              STATUS     LATENCY")];
  for (const def of SERVICES) {
    const runtime = state.services[def.id];
    const tone: TerminalLine["tone"] =
      runtime.status === "healthy" ? "ok" : runtime.status === "degraded" ? "warn" : "error";
    out.push(
      line(
        `${def.hostname.padEnd(40)}${def.ip.padEnd(16)}${runtime.status.toUpperCase().padEnd(11)}${Math.round(
          runtime.metrics.latencyMs ?? 0,
        )}ms`,
        tone,
      ),
    );
  }
  return out;
}

export function runHosts(): TerminalLine[] {
  const out: TerminalLine[] = [line("Known internal hostnames:", "muted")];
  for (const [host, service] of Object.entries(NETWORK_HOSTS)) {
    out.push(line(`  ${host.padEnd(38)} → ${getService(service).ip}`));
  }
  return out;
}

export function runHelp(): TerminalLine[] {
  const out: TerminalLine[] = [
    line("Meridian Cloud network diagnostics — simulated environment only.", "muted"),
    line("No real network traffic is generated by these commands.", "muted"),
    line(""),
  ];
  for (const entry of AVAILABLE_COMMANDS) {
    out.push(line(`  ${entry.command.padEnd(24)} ${entry.description}`));
  }
  return out;
}

export interface CommandResult {
  lines: TerminalLine[];
  /** Set when the command should clear the buffer instead of appending. */
  clear?: boolean;
  /** Evidence id recorded for scoring when the command is diagnostically useful. */
  evidence?: string;
}

/** Parse and execute one terminal command against the simulation. */
export function executeCommand(input: string, state: SimState, tick: number): CommandResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { lines: [] };

  const [command, ...args] = trimmed.split(/\s+/);
  const target = args[0];

  switch (command.toLowerCase()) {
    case "ping":
      if (!target) return { lines: [line("usage: ping <host>", "muted")] };
      return { lines: runPing(state, target, tick), evidence: "network:ping" };
    case "dig":
    case "nslookup":
      if (!target) return { lines: [line("usage: dig <host>", "muted")] };
      return { lines: runDig(state, target, tick), evidence: "network:dns" };
    case "traceroute":
    case "tracert":
      if (!target) return { lines: [line("usage: traceroute <host>", "muted")] };
      return { lines: runTraceroute(state, target, tick), evidence: "network:traceroute" };
    case "nc":
    case "telnet":
      if (!target) return { lines: [line("usage: nc <host> [port]", "muted")] };
      return {
        lines: runPortTest(state, target, args[1] ? Number(args[1]) : undefined, tick),
        evidence: "network:port",
      };
    case "curl":
      if (!target) return { lines: [line("usage: curl <host>", "muted")] };
      return { lines: runCurl(state, target, tick), evidence: "network:curl" };
    case "status":
      return { lines: runStatus(state), evidence: "network:status" };
    case "hosts":
      return { lines: runHosts() };
    case "help":
    case "?":
      return { lines: runHelp() };
    case "clear":
      return { lines: [], clear: true };
    default:
      return {
        lines: [
          line(`command not found: ${command}`, "error"),
          line("type 'help' to see available commands", "muted"),
        ],
      };
  }
}

export function makeLine(text: string, tone: TerminalLine["tone"]): TerminalLine {
  return line(text, tone);
}
