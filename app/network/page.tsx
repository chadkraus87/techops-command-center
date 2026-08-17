"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { cx, formatLatency, formatPercent } from "@/lib/format";
import {
  AVAILABLE_COMMANDS,
  dnsIsBroken,
  executeCommand,
  makeLine,
} from "@/lib/sim/network";
import { GATEWAY_IP, NETWORK_REGIONS, SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  Button,
  DetailList,
  DetailRow,
  Panel,
  PanelHeader,
  SectionLabel,
  StatusBadge,
} from "@/components/ui/primitives";
import type { TerminalLine } from "@/lib/sim/types";

/**
 * Network Center.
 *
 * The terminal is the diagnostic centrepiece. It is also the one place where a
 * public demo could plausibly be abused, so it is worth being explicit: every
 * command is answered from in-memory simulation state. There is no socket, no
 * fetch and no shell behind it — see lib/sim/network.ts.
 */

const SUGGESTED = [
  "ping api.internal",
  "dig customer-api.internal.meridian.io",
  "traceroute db.internal",
  "nc cache.internal 6379",
  "curl api.internal",
  "status",
];

export default function NetworkPage() {
  const state = useSimStore((s) => s.state);
  const noteEvidence = useSimStore((s) => s.noteEvidence);

  const [lines, setLines] = useState<TerminalLine[]>(() => [
    makeLine("Meridian Cloud network diagnostics v2.4", "muted"),
    makeLine("Simulated environment — no real network traffic is generated.", "muted"),
    makeLine("Type 'help' for available commands.", "muted"),
    makeLine("", "muted"),
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const run = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    const result = executeCommand(trimmed, state, state.tickCount);

    if (result.clear) {
      setLines([]);
    } else {
      setLines((current) => [
        ...current,
        makeLine(`ops@meridian:~$ ${trimmed}`, "input"),
        ...result.lines,
        makeLine("", "muted"),
      ]);
    }

    if (result.evidence && state.active) noteEvidence(result.evidence);

    setHistory((h) => [trimmed, ...h].slice(0, 40));
    setHistoryIndex(-1);
    setInput("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    run(input);
  };

  // Up/down recall through command history, as any shell would.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0 && history[next] !== undefined) {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setInput(next >= 0 ? (history[next] ?? "") : "");
    }
  };

  const dnsBroken = dnsIsBroken(state);
  const dataTierLoss = state.services["primary-db"]?.metrics.packetLoss ?? 0;
  const gateway = state.services["load-balancer"];

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="Network Center"
        description="WAN and internal network status with a diagnostic terminal. All tools operate against the simulated environment only — no real hosts are contacted."
      />

      {/* Network posture */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Panel className="p-4">
          <SectionLabel>WAN status</SectionLabel>
          <div className="mt-2 flex items-center gap-2">
            <Beacon status={gateway?.status ?? "healthy"} />
            <span className="text-[15px] font-semibold text-ink">
              {gateway?.status === "healthy" ? "Operational" : "Impaired"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-4">Gateway {GATEWAY_IP}</p>
        </Panel>

        <Panel className="p-4">
          <SectionLabel>DNS resolution</SectionLabel>
          <div className="mt-2 flex items-center gap-2">
            <Beacon status={dnsBroken ? "critical" : "healthy"} />
            <span
              className={cx(
                "text-[15px] font-semibold",
                dnsBroken ? "text-crit" : "text-ink",
              )}
            >
              {dnsBroken ? "SERVFAIL" : "Resolving"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-4">Resolver 10.20.0.53</p>
        </Panel>

        <Panel className="p-4">
          <SectionLabel>Packet loss</SectionLabel>
          <p
            className={cx(
              "tabnum mt-2 font-mono text-[20px] font-semibold",
              dataTierLoss > 0.03 ? "text-crit" : "text-ink",
            )}
          >
            {formatPercent(dataTierLoss, 1)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-4">Data subnet 10.20.30.0/24</p>
        </Panel>

        <Panel className="p-4">
          <SectionLabel>Edge latency</SectionLabel>
          <p className="tabnum mt-2 font-mono text-[20px] font-semibold text-ink">
            {formatLatency(state.services["edge-cdn"]?.metrics.latencyMs ?? 0)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-4">Global anycast</p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Terminal */}
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <TerminalIcon size={13} className="text-ok" />
                ops@meridian
              </span>
            }
            subtitle="Simulated diagnostics — ping, dig, traceroute, nc, curl"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines([])}
                aria-label="Clear terminal"
              >
                <Trash2 size={13} />
              </Button>
            }
          />

          <div
            ref={outputRef}
            className="terminal-surface h-[400px] overflow-y-auto bg-void/70 px-3.5 py-3 font-mono text-[11.5px] leading-[1.55]"
            role="log"
            aria-label="Terminal output"
          >
            {lines.map((line) => (
              <div
                key={line.id}
                className={cx(
                  "whitespace-pre-wrap break-words",
                  line.tone === "input" && "text-accent",
                  line.tone === "ok" && "text-ok",
                  line.tone === "warn" && "text-warn",
                  line.tone === "error" && "text-crit",
                  line.tone === "muted" && "text-ink-4",
                  line.tone === "output" && "text-ink-2",
                )}
              >
                {line.text || " "}
              </div>
            ))}
          </div>

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5"
          >
            <label htmlFor="terminal-input" className="sr-only">
              Terminal command
            </label>
            <span className="shrink-0 font-mono text-[11.5px] text-ok" aria-hidden="true">
              ops@meridian:~$
            </span>
            <input
              id="terminal-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
              placeholder="ping api.internal"
              className="h-6 min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-4"
            />
            {/* An explicit submit button is what makes Enter submit reliably in a
                single-input form, and gives touch users a way to run a command. */}
            <Button type="submit" variant="subtle" size="sm" disabled={input.trim().length === 0}>
              Run
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-2.5">
            {SUGGESTED.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => run(command)}
                className="rounded border border-line bg-surface-3 px-2 py-1 font-mono text-[10.5px] text-ink-3 transition-colors hover:border-accent/40 hover:bg-surface-4 hover:text-ink"
              >
                {command}
              </button>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          {/* Address table */}
          <Panel>
            <PanelHeader title="Address table" meta={`${SERVICES.length} hosts`} />
            <div className="max-h-[300px] overflow-y-auto">
              <ul className="divide-y divide-line">
                {SERVICES.map((service) => {
                  const runtime = state.services[service.id];
                  return (
                    <li
                      key={service.id}
                      className="flex items-center gap-2 px-4 py-1.5 font-mono text-[11px]"
                    >
                      <Beacon status={runtime.status} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{service.name}</span>
                      <span className="tabnum shrink-0 text-ink-4">{service.ip}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>

          {/* Regions */}
          <Panel>
            <PanelHeader title="Regions" />
            <DetailList className="px-4">
              {NETWORK_REGIONS.map((region) => (
                <DetailRow
                  key={region.id}
                  label={region.label}
                  value={
                    <span className="flex items-center justify-end gap-2">
                      <StatusBadge
                        status={
                          region.id === "eu-west-1" &&
                          state.services["edge-cdn"]?.status !== "healthy"
                            ? "degraded"
                            : "healthy"
                        }
                      />
                    </span>
                  }
                />
              ))}
            </DetailList>
          </Panel>

          {/* Command reference */}
          <Panel>
            <PanelHeader title="Command reference" />
            <ul className="divide-y divide-line">
              {AVAILABLE_COMMANDS.map((entry) => (
                <li key={entry.command} className="px-4 py-2">
                  <p className="font-mono text-[11.5px] text-ink-2">{entry.command}</p>
                  <p className="mt-0.5 text-[11px] text-ink-4">{entry.description}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
