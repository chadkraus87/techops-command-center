"use client";

import { useMemo, useState } from "react";
import {
  cx,
  formatCompact,
  formatInteger,
  formatLatency,
  formatPercent,
} from "@/lib/format";
import { buildSeries, TIME_RANGES, type TimeRange } from "@/lib/sim/history";
import { getService, SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { TimeSeriesChart, type ChartTone } from "@/components/charts";
import { PageIntro } from "@/components/ui/page-intro";
import { Panel, PanelHeader, SectionLabel, ToggleGroup } from "@/components/ui/primitives";
import type { MetricKey, ServiceId } from "@/lib/sim/types";

/**
 * Metrics dashboard.
 *
 * One service at a time, every channel it exposes. Charting a single service
 * across many metrics answers "what is wrong with this thing?", which is the
 * question an operator actually has — whereas one metric across many services
 * mostly produces a tangle of lines nobody reads.
 */

interface MetricSpec {
  key: MetricKey;
  label: string;
  description: string;
  format: (value: number) => string;
  tone: ChartTone;
  zeroBased?: boolean;
  threshold?: (serviceId: ServiceId) => { value: number; label: string } | undefined;
}

const METRIC_SPECS: MetricSpec[] = [
  {
    key: "latencyMs",
    label: "Response time",
    description: "Median request duration",
    format: formatLatency,
    tone: "accent",
    threshold: (id) => ({ value: getService(id).slo.latencyMs, label: "SLO" }),
  },
  {
    key: "errorRate",
    label: "Error rate",
    description: "Share of requests returning 5xx",
    format: (v) => formatPercent(v, 2),
    tone: "crit",
    threshold: (id) => ({ value: getService(id).slo.errorRate, label: "SLO" }),
  },
  {
    key: "rps",
    label: "Throughput",
    description: "Requests handled per second",
    format: (v) => `${formatCompact(v)}/s`,
    tone: "info",
  },
  {
    key: "cpu",
    label: "CPU utilisation",
    description: "Percentage of allocated compute in use",
    format: (v) => `${Math.round(v)}%`,
    tone: "warn",
    threshold: () => ({ value: 90, label: "alert" }),
  },
  {
    key: "memory",
    label: "Memory utilisation",
    description: "Percentage of allocated memory resident",
    format: (v) => `${Math.round(v)}%`,
    tone: "series-2",
    threshold: () => ({ value: 90, label: "alert" }),
  },
  {
    key: "connections",
    label: "Database connections",
    description: "Active connections against the pool limit",
    format: formatInteger,
    tone: "series-1",
    threshold: (id) => {
      const limit = getService(id).baseline.connectionLimit;
      return limit ? { value: limit, label: "pool limit" } : undefined;
    },
  },
  {
    key: "cacheHitRate",
    label: "Cache hit rate",
    description: "Share of reads served from cache",
    format: (v) => formatPercent(v, 1),
    tone: "ok",
  },
  {
    key: "queueDepth",
    label: "Queue depth",
    description: "Messages waiting to be consumed",
    format: formatInteger,
    tone: "series-2",
  },
  {
    key: "diskUsage",
    label: "Disk usage",
    description: "Percentage of provisioned storage consumed",
    format: (v) => `${v.toFixed(1)}%`,
    tone: "series-1",
    threshold: () => ({ value: 85, label: "alert" }),
  },
];

export default function MetricsPage() {
  const [serviceId, setServiceId] = useState<ServiceId>("api-gateway");
  const [range, setRange] = useState<TimeRange>("1h");

  const state = useSimStore((s) => s.state);
  const def = getService(serviceId);
  const runtime = state.services[serviceId];

  // Only chart channels this service actually reports.
  const specs = useMemo(
    () => METRIC_SPECS.filter((spec) => runtime.metrics[spec.key] !== undefined),
    [runtime.metrics],
  );

  const seriesByMetric = useMemo(() => {
    const map = new Map<MetricKey, ReturnType<typeof buildSeries>>();
    for (const spec of specs) {
      map.set(spec.key, buildSeries(state, serviceId, spec.key, range));
    }
    return map;
    // Recomputes each tick, which is the point of a live dashboard.
  }, [state, serviceId, range, specs]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="Metrics"
        description="Every metric channel a service reports, over the selected window. Dashed reference lines mark the SLO or alert threshold that governs each channel."
        actions={
          <ToggleGroup
            label="Time range"
            value={range}
            onChange={setRange}
            options={TIME_RANGES.map((r) => ({ value: r.value, label: r.label }))}
          />
        }
      />

      {/* Service selector */}
      <Panel>
        <div className="flex flex-wrap items-center gap-1.5 p-3">
          <SectionLabel className="mr-1">Service</SectionLabel>
          {SERVICES.map((service) => {
            const status = state.services[service.id].status;
            const selected = service.id === serviceId;
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => setServiceId(service.id)}
                aria-pressed={selected}
                className={cx(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition-colors",
                  selected
                    ? "border-accent/50 bg-accent/12 text-ink"
                    : "border-line bg-surface-3/60 text-ink-3 hover:bg-surface-3 hover:text-ink",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-1.5 w-1.5 rounded-full",
                    status === "healthy" && "bg-ok",
                    status === "degraded" && "bg-warn",
                    (status === "critical" || status === "offline") && "bg-crit",
                  )}
                />
                {service.name}
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Header strip for the selected service */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          { label: "Median latency", value: formatLatency(runtime.metrics.latencyMs ?? 0) },
          { label: "p95", value: formatLatency(runtime.metrics.latencyP95 ?? 0) },
          { label: "p99", value: formatLatency(runtime.metrics.latencyP99 ?? 0) },
          { label: "Error rate", value: formatPercent(runtime.metrics.errorRate ?? 0, 2) },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-2 px-4 py-3">
            <p className="text-[11px] text-ink-3">{stat.label}</p>
            <p className="tabnum mt-0.5 font-mono text-[18px] font-semibold text-ink">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {specs.map((spec) => {
          const data = seriesByMetric.get(spec.key) ?? [];
          const current = runtime.metrics[spec.key] ?? 0;
          const threshold = spec.threshold?.(serviceId);
          const breaching = threshold ? current > threshold.value : false;

          return (
            <Panel key={spec.key}>
              <PanelHeader
                title={spec.label}
                subtitle={spec.description}
                meta={
                  <span className={cx(breaching && "text-warn")}>{spec.format(current)}</span>
                }
              />
              <div className="p-3 pr-4">
                <TimeSeriesChart
                  data={data}
                  tone={breaching ? "crit" : spec.tone}
                  height={150}
                  formatter={spec.format}
                  threshold={threshold}
                  zeroBased={spec.key !== "cacheHitRate"}
                />
              </div>
            </Panel>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-4">
        {def.name} · {def.hostname} · owned by {def.owner} ({def.team}). Windows longer than four
        minutes are reconstructed from the same deterministic baseline model that generates live
        telemetry, so history and live data always agree.
      </p>
    </div>
  );
}
