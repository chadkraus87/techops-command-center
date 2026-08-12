"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pause, Play, Search, X } from "lucide-react";
import { cx, formatTimePrecise } from "@/lib/format";
import { LOG_LEVEL_RANK, LOG_LEVELS } from "@/lib/sim/logs";
import { SERVICES, serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Button,
  DetailList,
  DetailRow,
  EmptyState,
  Panel,
  SectionLabel,
  SkeletonRows,
  ToggleGroup,
} from "@/components/ui/primitives";
import type { LogEntry, LogLevel, ServiceId } from "@/lib/sim/types";

/**
 * Log explorer.
 *
 * The stream auto-follows the tail, but pauses the moment you scroll up — the
 * same behaviour as `tail -f` in a pager, and the thing that makes a live log
 * viewer usable rather than infuriating. Pausing freezes the *view*, not the
 * simulation, so lines keep accruing behind you and appear when you resume.
 */

const LEVEL_CLASS: Record<LogLevel, string> = {
  DEBUG: "text-ink-4",
  INFO: "text-info",
  WARN: "text-warn",
  ERROR: "text-crit",
  CRITICAL: "text-crit font-bold",
};

const LEVEL_ROW_CLASS: Record<LogLevel, string> = {
  DEBUG: "",
  INFO: "",
  WARN: "bg-warn/[0.035]",
  ERROR: "bg-crit/[0.045]",
  CRITICAL: "bg-crit/[0.09]",
};

function LogsContent() {
  const searchParams = useSearchParams();
  const serviceParam = searchParams.get("service");

  const logs = useSimStore((s) => s.state.logs);
  const activeIncidentId = useSimStore((s) => s.state.active?.incidentId);
  const noteEvidence = useSimStore((s) => s.noteEvidence);

  const [minLevel, setMinLevel] = useState<LogLevel>("DEBUG");
  const [service, setService] = useState<ServiceId | "all">(
    serviceParam && SERVICES.some((s) => s.id === serviceParam)
      ? (serviceParam as ServiceId)
      : "all",
  );
  const [query, setQuery] = useState("");
  const [incidentOnly, setIncidentOnly] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);

  /**
   * Pausing captures the buffer as it stands. Holding the snapshot in state
   * (rather than a ref updated by an effect) is what actually makes the view
   * freeze — the simulation keeps producing lines behind it, and they appear
   * on resume.
   */
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const paused = frozen !== null;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Reading logs during an incident counts as investigation.
  useEffect(() => {
    if (activeIncidentId) noteEvidence("logs:viewed");
  }, [activeIncidentId, noteEvidence]);

  const filtered = useMemo(() => {
    const source = frozen ?? logs;
    const q = query.trim().toLowerCase();
    const minRank = LOG_LEVEL_RANK[minLevel];

    return source.filter((entry) => {
      if (LOG_LEVEL_RANK[entry.level] < minRank) return false;
      if (service !== "all" && entry.service !== service) return false;
      if (incidentOnly && !entry.incidentId) return false;
      if (!q) return true;
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.requestId.toLowerCase().includes(q) ||
        entry.host.toLowerCase().includes(q) ||
        entry.service.includes(q)
      );
    });
  }, [logs, frozen, minLevel, service, query, incidentOnly]);

  // Follow the tail unless the reader has scrolled away from it.
  const followRef = useRef(true);
  useEffect(() => {
    if (paused || !followRef.current) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [filtered, paused]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    followRef.current = distanceFromBottom < 40;
  };

  const errorCount = filtered.filter((l) => l.level === "ERROR" || l.level === "CRITICAL").length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="Log Explorer"
        description="Live structured logs from every service. Filter by severity, service, incident or free text, and select any line to inspect its metadata."
        meta={
          <span className="tabnum inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
            <span
              className={cx(
                "beacon",
                paused ? "bg-idle" : "bg-ok beacon-pulse",
              )}
              aria-hidden="true"
            />
            {paused ? "Paused" : "Streaming"}
          </span>
        }
        actions={
          <Button
            variant={paused ? "primary" : "secondary"}
            size="sm"
            icon={paused ? <Play size={13} /> : <Pause size={13} />}
            onClick={() => setFrozen((current) => (current ? null : logs))}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        }
      />

      <Panel className="flex min-h-0 flex-col">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages, request IDs, hosts…"
              aria-label="Search logs"
              className="h-5 min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-4"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 text-ink-4 hover:text-ink"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <ToggleGroup
            label="Minimum severity"
            value={minLevel}
            onChange={setMinLevel}
            options={LOG_LEVELS.map((level) => ({ value: level, label: level }))}
          />

          <select
            value={service}
            onChange={(event) => setService(event.target.value as ServiceId | "all")}
            aria-label="Filter by service"
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11.5px] text-ink-2 outline-none hover:bg-surface-3"
          >
            <option value="all">All services</option>
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-[11.5px] text-ink-2 hover:bg-surface-3">
            <input
              type="checkbox"
              checked={incidentOnly}
              onChange={(event) => setIncidentOnly(event.target.checked)}
              className="h-3 w-3 accent-[var(--color-accent)]"
            />
            Incident only
          </label>

          <span className="tabnum ml-auto shrink-0 font-mono text-[11px] text-ink-4">
            {filtered.length} lines
            {errorCount > 0 ? <span className="text-crit"> · {errorCount} errors</span> : null}
          </span>
        </div>

        {/* Stream */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={16} />}
            title="No matching log lines"
            description="Nothing in the current buffer matches these filters. Try lowering the severity or clearing the search."
          />
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-[calc(100dvh-320px)] min-h-[320px] overflow-y-auto bg-void/50 font-mono text-[11.5px]"
            role="log"
            aria-label="Log stream"
            aria-live="off"
          >
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelected(entry)}
                className={cx(
                  "flex w-full gap-3 border-b border-line/40 px-3 py-1 text-left transition-colors hover:bg-surface-3/70",
                  LEVEL_ROW_CLASS[entry.level],
                  selected?.id === entry.id && "bg-surface-4",
                )}
              >
                <span className="tabnum hidden shrink-0 text-ink-4 sm:inline">
                  {formatTimePrecise(entry.timestamp)}
                </span>
                <span className={cx("w-[62px] shrink-0 font-semibold", LEVEL_CLASS[entry.level])}>
                  {entry.level}
                </span>
                <span className="hidden w-[130px] shrink-0 truncate text-accent/80 md:inline">
                  {entry.service}
                </span>
                <span className="min-w-0 flex-1 break-words text-ink-2">{entry.message}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* Structured detail */}
      {selected ? (
        <Panel>
          <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <SectionLabel>Log entry</SectionLabel>
              <p className="mt-1 break-words font-mono text-[12px] text-ink">{selected.message}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
              aria-label="Close log detail"
            >
              <X size={14} />
            </Button>
          </div>
          <div className="grid gap-x-6 px-4 py-1 sm:grid-cols-2">
            <DetailList>
              <DetailRow label="Timestamp" value={formatTimePrecise(selected.timestamp)} mono />
              <DetailRow label="Level" value={selected.level} mono />
              <DetailRow label="Service" value={serviceName(selected.service)} />
              <DetailRow label="Host" value={selected.host} mono />
            </DetailList>
            <DetailList>
              <DetailRow label="Request ID" value={selected.requestId} mono />
              <DetailRow label="Environment" value={selected.environment} />
              <DetailRow label="Incident" value={selected.incidentId ?? "—"} mono />
              <DetailRow
                label="Fields"
                value={selected.fields ? `${Object.keys(selected.fields).length}` : "0"}
                mono
              />
            </DetailList>
          </div>
          {selected.fields ? (
            <div className="border-t border-line px-4 py-3">
              <SectionLabel className="mb-1.5 block">Structured fields</SectionLabel>
              <pre className="overflow-x-auto rounded-md border border-line bg-void/70 p-3 font-mono text-[11px] leading-relaxed text-ink-2">
                {JSON.stringify(selected.fields, null, 2)}
              </pre>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

export default function LogsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={12} />}>
      <LogsContent />
    </Suspense>
  );
}
