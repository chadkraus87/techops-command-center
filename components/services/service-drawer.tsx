"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import {
  cx,
  formatAvailability,
  formatCompact,
  formatDuration,
  formatLatency,
  formatPercent,
  formatRelative,
  formatTime,
} from "@/lib/format";
import { buildSeries } from "@/lib/sim/history";
import { dependentsOf, getService, serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { MultiLineChart, TimeSeriesChart, ChartLegend } from "@/components/charts";
import { Drawer } from "@/components/ui/overlay";
import {
  Beacon,
  DetailList,
  DetailRow,
  Meter,
  SectionLabel,
  StatusBadge,
} from "@/components/ui/primitives";
import type { ServiceId } from "@/lib/sim/types";

/**
 * Service detail.
 *
 * Reachable from the topology, the catalogue, the hero strip and the command
 * palette, so it is one component rather than four near-copies. Whenever it is
 * opened during an incident it records the fact as investigation evidence,
 * which is how the score can reward looking before acting.
 */

/** Percentiles are ordered, so they use a single-hue ramp, not categorical hues. */
const PERCENTILE_SERIES = [
  { key: "p50", name: "p50", color: "var(--color-seq-1)" },
  { key: "p95", name: "p95", color: "var(--color-seq-2)" },
  { key: "p99", name: "p99", color: "var(--color-seq-3)" },
];

export function ServiceDrawer({
  serviceId,
  onClose,
}: {
  serviceId: ServiceId | null;
  onClose: () => void;
}) {
  const state = useSimStore((s) => s.state);
  const noteEvidence = useSimStore((s) => s.noteEvidence);

  const def = serviceId ? getService(serviceId) : null;
  const runtime = serviceId ? state.services[serviceId] : null;

  const latencySeries = useMemo(() => {
    if (!serviceId) return [];
    const p50 = buildSeries(state, serviceId, "latencyMs", "15m");
    const p95 = buildSeries(state, serviceId, "latencyP95", "15m");
    const p99 = buildSeries(state, serviceId, "latencyP99", "15m");
    return [
      { ...PERCENTILE_SERIES[0], data: p50 },
      { ...PERCENTILE_SERIES[1], data: p95 },
      { ...PERCENTILE_SERIES[2], data: p99 },
    ];
    // A new sample each tick is exactly when this should recompute.
  }, [state, serviceId]);

  const errorSeries = useMemo(
    () => (serviceId ? buildSeries(state, serviceId, "errorRate", "15m") : []),
    [state, serviceId],
  );

  if (!def || !runtime || !serviceId) return null;

  // Opening the panel is itself an investigative act.
  const evidenceKey = `service:${serviceId}`;

  const relatedAlerts = state.alerts.filter(
    (a) => a.service === serviceId && a.resolvedAt === null,
  );
  const relatedLogs = state.logs
    .filter((l) => l.service === serviceId)
    .slice(-8)
    .reverse();
  const dependents = dependentsOf(serviceId);
  const connections = runtime.metrics.connections;
  const connectionLimit = def.baseline.connectionLimit;

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={
        <span className="flex items-center gap-2">
          <Beacon status={runtime.status} />
          {def.name}
        </span>
      }
      subtitle={
        <span className="font-mono text-[11px] text-ink-4">
          {def.hostname} · {def.ip} · v{def.version.replace(/^[a-z-]+/, "")}
        </span>
      }
    >
      <EvidenceRecorder evidenceKey={evidenceKey} enabled={state.active !== null} onRecord={noteEvidence} />
      <div className="space-y-5 p-5">
        {/* Status */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={runtime.status} size="md" />
          {runtime.reason ? (
            <span className="text-[12px] text-ink-3">{runtime.reason}</span>
          ) : (
            <span className="text-[12px] text-ink-4">Operating within SLO</span>
          )}
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-3">{def.description}</p>

        {/* Live metrics */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
          {[
            { label: "Latency", value: formatLatency(runtime.metrics.latencyMs ?? 0) },
            { label: "Throughput", value: `${formatCompact(runtime.metrics.rps ?? 0)}/s` },
            {
              label: "Error rate",
              value: formatPercent(runtime.metrics.errorRate ?? 0, 2),
            },
            { label: "CPU", value: `${Math.round(runtime.metrics.cpu ?? 0)}%` },
          ].map((metric) => (
            <div key={metric.label} className="bg-surface-2 px-3 py-2.5">
              <p className="text-[10.5px] text-ink-4">{metric.label}</p>
              <p className="tabnum mt-0.5 font-mono text-[15px] font-medium text-ink">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        {/* Connection pool, where it applies */}
        {connections !== undefined && connectionLimit !== undefined ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <SectionLabel>Connection pool</SectionLabel>
              <span className="tabnum font-mono text-[11.5px] text-ink-2">
                {connections} / {connectionLimit}
              </span>
            </div>
            <Meter
              value={connections}
              max={connectionLimit}
              label="Connection pool utilisation"
              tone={
                connections / connectionLimit > 0.95
                  ? "crit"
                  : connections / connectionLimit > 0.85
                    ? "warn"
                    : "ok"
              }
            />
          </div>
        ) : null}

        {/* Latency percentiles */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <SectionLabel>Latency percentiles · 15m</SectionLabel>
            <ChartLegend series={PERCENTILE_SERIES} />
          </div>
          <MultiLineChart series={latencySeries} height={150} formatter={formatLatency} />
        </section>

        {/* Error rate */}
        <section>
          <SectionLabel className="mb-2 block">Error rate · 15m</SectionLabel>
          <TimeSeriesChart
            data={errorSeries}
            tone={(runtime.metrics.errorRate ?? 0) > def.slo.errorRate ? "crit" : "ok"}
            height={120}
            formatter={(v) => formatPercent(v, 1)}
            threshold={{ value: def.slo.errorRate, label: "SLO" }}
          />
        </section>

        {/* Metadata */}
        <section>
          <SectionLabel className="mb-1 block">Service details</SectionLabel>
          <DetailList>
            <DetailRow label="Owner" value={def.owner} />
            <DetailRow label="Team" value={def.team} />
            <DetailRow label="Version" value={def.version} mono />
            <DetailRow label="Regions" value={def.regions.join(", ")} />
            <DetailRow label="Tier" value={def.tier} />
            <DetailRow
              label="Availability (30d)"
              value={formatAvailability(
                1 - runtime.downtimeSeconds / Math.max(1, runtime.uptimeSeconds),
              )}
            />
            <DetailRow label="SLO target" value={formatAvailability(def.slo.availability)} />
            <DetailRow
              label="Uptime"
              value={formatDuration(runtime.uptimeSeconds)}
            />
            <DetailRow label="Customer facing" value={def.customerFacing ? "Yes" : "No"} />
          </DetailList>
        </section>

        {/* Dependencies */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel className="mb-1.5 block">Depends on</SectionLabel>
            {def.dependencies.length === 0 && (def.softDependencies ?? []).length === 0 ? (
              <p className="text-[12px] text-ink-4">No dependencies</p>
            ) : (
              <ul className="space-y-1">
                {def.dependencies.map((dep) => (
                  <DependencyRow key={dep} id={dep} kind="hard" />
                ))}
                {(def.softDependencies ?? []).map((dep) => (
                  <DependencyRow key={dep} id={dep} kind="soft" />
                ))}
              </ul>
            )}
          </div>
          <div>
            <SectionLabel className="mb-1.5 block">Depended on by</SectionLabel>
            {dependents.length === 0 ? (
              <p className="text-[12px] text-ink-4">Nothing depends on this service</p>
            ) : (
              <ul className="space-y-1">
                {dependents.map((dep) => (
                  <DependencyRow key={dep} id={dep} kind="hard" />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Alerts */}
        <section>
          <SectionLabel className="mb-1.5 block">
            Active alerts {relatedAlerts.length > 0 ? `(${relatedAlerts.length})` : ""}
          </SectionLabel>
          {relatedAlerts.length === 0 ? (
            <p className="text-[12px] text-ink-4">No firing alerts for this service</p>
          ) : (
            <ul className="space-y-1.5">
              {relatedAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className={cx(
                    "rounded-md border px-2.5 py-2",
                    alert.severity === "critical"
                      ? "border-crit/25 bg-crit/8"
                      : "border-warn/25 bg-warn/8",
                  )}
                >
                  <p className="text-[12px] font-medium text-ink">{alert.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{alert.detail}</p>
                  <p className="tabnum mt-0.5 font-mono text-[10px] text-ink-4">
                    Fired {formatRelative(alert.firedAt, state.clock)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent logs */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Recent log lines</SectionLabel>
            <Link
              href={`/logs?service=${serviceId}`}
              className="text-[11px] text-accent hover:underline"
            >
              Open in log explorer →
            </Link>
          </div>
          <div className="overflow-hidden rounded-md border border-line bg-void/60">
            {relatedLogs.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-ink-4">No recent lines</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {relatedLogs.map((log) => (
                  <li key={log.id} className="flex gap-2 px-2.5 py-1.5 font-mono text-[10.5px]">
                    <span className="tabnum shrink-0 text-ink-4">{formatTime(log.timestamp)}</span>
                    <span
                      className={cx(
                        "w-14 shrink-0 font-semibold",
                        log.level === "ERROR" || log.level === "CRITICAL"
                          ? "text-crit"
                          : log.level === "WARN"
                            ? "text-warn"
                            : "text-ink-4",
                      )}
                    >
                      {log.level}
                    </span>
                    <span className="min-w-0 flex-1 break-all text-ink-2">{log.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </Drawer>
  );
}

/**
 * Records that a piece of evidence was actually viewed, exactly once per mount.
 * Kept as its own component so the effect's dependencies are unambiguous.
 */
function EvidenceRecorder({
  evidenceKey,
  enabled,
  onRecord,
}: {
  evidenceKey: string;
  enabled: boolean;
  onRecord: (key: string) => void;
}) {
  useEffect(() => {
    if (enabled) onRecord(evidenceKey);
  }, [evidenceKey, enabled, onRecord]);
  return null;
}

function DependencyRow({ id, kind }: { id: ServiceId; kind: "hard" | "soft" }) {
  const status = useSimStore((s) => s.state.services[id]?.status ?? "healthy");
  return (
    <li className="flex items-center gap-2 rounded border border-line bg-surface-3/50 px-2 py-1.5">
      <Beacon status={status} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{serviceName(id)}</span>
      {kind === "soft" ? (
        <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-ink-4">soft</span>
      ) : null}
    </li>
  );
}
