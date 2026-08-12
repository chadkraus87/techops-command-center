"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  cx,
  formatCompact,
  formatLatency,
  formatPercent,
  STATUS_LABEL,
} from "@/lib/format";
import { buildGlobalSeries, sparkSeries, type TimeRange } from "@/lib/sim/history";
import { statusRank } from "@/lib/sim/metrics";
import { SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Sparkline, TimeSeriesChart } from "@/components/charts";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { HeroStatus } from "@/components/dashboard/hero-status";
import { ServiceDrawer } from "@/components/services/service-drawer";
import { TopologyMap, TopologyLegend } from "@/components/topology/topology-map";
import { Panel, PanelHeader, StatusBadge, ToggleGroup } from "@/components/ui/primitives";
import type { ServiceId } from "@/lib/sim/types";

/**
 * Overview / Command Center.
 *
 * Composition is intentionally uneven — a full-bleed hero, then a wide chart
 * beside a narrow one, then a three-column band. A uniform grid of equal cards
 * would carry the same data and communicate far less about what matters.
 */

/**
 * Fleet-level reference lines. These double as the y-axis scale for the compact
 * charts, which is what keeps a healthy trace sitting low in its panel instead
 * of being auto-scaled up to fill it.
 */
const FLEET_ERROR_BUDGET = 0.01;
const FLEET_LATENCY_TARGET = 250;

const RANGE_OPTIONS: Array<{ value: TimeRange; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
];

export default function OverviewPage() {
  const [range, setRange] = useState<TimeRange>("15m");
  const [selectedService, setSelectedService] = useState<ServiceId | null>(null);

  const state = useSimStore((s) => s.state);

  const rpsSeries = useMemo(() => buildGlobalSeries(state, "rps", range), [state, range]);
  const errorSeries = useMemo(() => buildGlobalSeries(state, "errorRate", range), [state, range]);
  const latencySeries = useMemo(() => buildGlobalSeries(state, "latency", range), [state, range]);

  // Worst-first: during an incident the services that need attention rise to
  // the top without the operator having to sort anything.
  const rankedServices = useMemo(
    () =>
      [...SERVICES]
        .map((def) => ({ def, runtime: state.services[def.id] }))
        .sort((a, b) => {
          const rank = statusRank(b.runtime.status) - statusRank(a.runtime.status);
          if (rank !== 0) return rank;
          return (b.runtime.metrics.rps ?? 0) - (a.runtime.metrics.rps ?? 0);
        }),
    [state.services],
  );

  const errorRate = errorSeries[errorSeries.length - 1]?.v ?? 0;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <HeroStatus />

      {/* Charts: one wide, one narrow — not two equal boxes. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Request throughput"
            subtitle="Aggregate requests per second across customer-facing services"
            actions={
              <ToggleGroup
                label="Time range"
                options={RANGE_OPTIONS}
                value={range}
                onChange={setRange}
              />
            }
          />
          <div className="p-3 pr-4">
            <TimeSeriesChart
              data={rpsSeries}
              tone="accent"
              height={210}
              formatter={(v) => formatCompact(v)}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Error rate"
            subtitle="Traffic-weighted across the fleet"
            meta={formatPercent(errorRate, errorRate > 0.01 ? 1 : 2)}
          />
          <div className="p-3 pr-4">
            {/* The SLO line also sets the scale, so a healthy trace reads as a
                low line under its budget rather than filling the panel. */}
            <TimeSeriesChart
              data={errorSeries}
              tone={errorRate > 0.02 ? "crit" : errorRate > 0.005 ? "warn" : "ok"}
              height={94}
              formatter={(v) => formatPercent(v, 1)}
              threshold={{ value: FLEET_ERROR_BUDGET, label: "1% budget" }}
              showAxis={false}
            />
          </div>
          <div className="flex items-baseline justify-between border-t border-line px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">
              Average latency
            </p>
            <span className="tabnum font-mono text-[11px] text-ink-3">
              {formatLatency(latencySeries[latencySeries.length - 1]?.v ?? 0)}
            </span>
          </div>
          <div className="p-3 pr-4">
            <TimeSeriesChart
              data={latencySeries}
              tone="info"
              height={94}
              formatter={formatLatency}
              threshold={{ value: FLEET_LATENCY_TARGET, label: "target" }}
              showAxis={false}
            />
          </div>
        </Panel>
      </div>

      {/* Band: services, topology, activity */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="flex flex-col xl:col-span-1">
          <PanelHeader
            title="Services"
            meta={`${rankedServices.filter((s) => s.runtime.status === "healthy").length}/${SERVICES.length} healthy`}
            actions={
              <Link
                href="/services"
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                All <ArrowUpRight size={11} />
              </Link>
            }
          />
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {rankedServices.slice(0, 9).map(({ def, runtime }) => (
              <li key={def.id}>
                <button
                  type="button"
                  onClick={() => setSelectedService(def.id)}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-3/60"
                >
                  <span
                    className={cx(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      runtime.status === "healthy" && "bg-ok",
                      runtime.status === "degraded" && "bg-warn",
                      (runtime.status === "critical" || runtime.status === "offline") && "bg-crit",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                    {def.name}
                  </span>
                  <Sparkline
                    values={sparkSeries(state, def.id, "latencyMs", 32)}
                    tone={
                      runtime.status === "healthy"
                        ? "ok"
                        : runtime.status === "degraded"
                          ? "warn"
                          : "crit"
                    }
                    width={44}
                    height={16}
                  />
                  <span className="tabnum w-14 shrink-0 text-right font-mono text-[11px] text-ink-3">
                    {formatLatency(runtime.metrics.latencyMs ?? 0)}
                  </span>
                  <span className="sr-only">{STATUS_LABEL[runtime.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="flex flex-col xl:col-span-1">
          <PanelHeader
            title="Topology"
            subtitle="Live dependency map"
            actions={
              <Link
                href="/infrastructure"
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                Expand <ArrowUpRight size={11} />
              </Link>
            }
          />
          <div className="min-h-0 flex-1 p-4">
            <TopologyMap compact className="h-[280px]" onSelect={setSelectedService} />
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <TopologyLegend />
          </div>
        </Panel>

        <Panel className="flex flex-col xl:col-span-1">
          <PanelHeader title="Activity" subtitle="Alerts, incidents, tickets and releases" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ActivityFeed limit={12} />
          </div>
        </Panel>
      </div>

      {/* Incidents */}
      <Panel>
        <PanelHeader
          title="Incidents"
          subtitle="Most recent first"
          actions={
            <Link
              href="/incidents"
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 transition-colors hover:text-ink"
            >
              All incidents <ArrowUpRight size={11} />
            </Link>
          }
        />
        {state.incidents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[13px] font-medium text-ink-2">No incidents recorded</p>
            <p className="max-w-md text-[12px] leading-relaxed text-ink-4">
              The environment is healthy. Trigger a simulation to generate a live incident with a
              full timeline, evidence trail and scored investigation.
            </p>
            <Link
              href="/simulation"
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-4"
            >
              Open Simulation Center
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {state.incidents.slice(0, 4).map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/incidents?id=${incident.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-3/60"
                >
                  <span className="tabnum font-mono text-[11.5px] text-ink-4">{incident.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    {incident.title}
                  </span>
                  <StatusBadge
                    status={
                      incident.status === "resolved"
                        ? "healthy"
                        : incident.status === "monitoring"
                          ? "degraded"
                          : "critical"
                    }
                  />
                  <span className="text-[11.5px] capitalize text-ink-3">{incident.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ServiceDrawer serviceId={selectedService} onClose={() => setSelectedService(null)} />
    </div>
  );
}
