"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import {
  cx,
  formatAvailability,
  formatCompact,
  formatLatency,
  formatPercent,
  formatRelative,
  STATUS_LABEL,
} from "@/lib/format";
import { sparkSeries } from "@/lib/sim/history";
import { statusRank } from "@/lib/sim/metrics";
import { SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Sparkline } from "@/components/charts";
import { ServiceDrawer } from "@/components/services/service-drawer";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  EmptyState,
  Panel,
  SkeletonRows,
  StatusBadge,
  ToggleGroup,
} from "@/components/ui/primitives";
import type { HealthStatus, ServiceId } from "@/lib/sim/types";

/**
 * Service catalogue.
 *
 * A dense table rather than a grid of cards: this is a comparison surface, and
 * comparison wants aligned columns. On narrow screens the same rows collapse to
 * a stacked layout instead of scrolling sideways.
 */

type StatusFilter = "all" | "unhealthy" | HealthStatus;

function ServicesContent() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("service");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<ServiceId | null>(
    initial && SERVICES.some((s) => s.id === initial) ? (initial as ServiceId) : null,
  );

  const state = useSimStore((s) => s.state);
  const deployments = useSimStore((s) => s.state.deployments);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SERVICES.map((def) => ({ def, runtime: state.services[def.id] }))
      .filter(({ def, runtime }) => {
        if (filter === "unhealthy" && runtime.status === "healthy") return false;
        if (filter !== "all" && filter !== "unhealthy" && runtime.status !== filter) return false;
        if (!q) return true;
        return (
          def.name.toLowerCase().includes(q) ||
          def.team.toLowerCase().includes(q) ||
          def.owner.toLowerCase().includes(q) ||
          def.hostname.toLowerCase().includes(q) ||
          def.ip.includes(q)
        );
      })
      .sort((a, b) => {
        const rank = statusRank(b.runtime.status) - statusRank(a.runtime.status);
        if (rank !== 0) return rank;
        return a.def.name.localeCompare(b.def.name);
      });
  }, [state.services, query, filter]);

  const lastDeploymentFor = (serviceId: ServiceId) =>
    deployments.find((d) => d.service === serviceId);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="Service Catalogue"
        description="Every service in the platform with its owner, version, SLO and live health. Select any row for metrics, dependencies, alerts and recent logs."
        actions={
          <ToggleGroup
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "unhealthy", label: "Issues" },
              { value: "healthy", label: "Healthy" },
            ]}
          />
        }
      />

      <Panel className="overflow-hidden">
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Search size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, team, owner, hostname or IP…"
            aria-label="Filter services"
            className="h-6 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-4"
          />
          <span className="tabnum shrink-0 font-mono text-[11px] text-ink-4">
            {rows.length}/{SERVICES.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Search size={16} />}
            title="No services match"
            description="Try a different search term, or clear the status filter."
          />
        ) : (
          <>
            {/* Column headers — desktop only */}
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 lg:flex">
              <span className="w-[220px] shrink-0">Service</span>
              <span className="w-[92px] shrink-0">Status</span>
              <span className="w-[78px] shrink-0 text-right">Latency</span>
              <span className="w-[70px] shrink-0 text-right">Traffic</span>
              <span className="w-[68px] shrink-0 text-right">Errors</span>
              <span className="w-[72px] shrink-0 text-right">Uptime</span>
              <span className="w-[60px] shrink-0" />
              <span className="min-w-0 flex-1">Owner</span>
              <span className="w-[130px] shrink-0 text-right">Last deploy</span>
            </div>

            <ul className="divide-y divide-line">
              {rows.map(({ def, runtime }) => {
                const deployment = lastDeploymentFor(def.id);
                const availability =
                  1 - runtime.downtimeSeconds / Math.max(1, runtime.uptimeSeconds);
                const tone =
                  runtime.status === "healthy"
                    ? "ok"
                    : runtime.status === "degraded"
                      ? "warn"
                      : "crit";

                return (
                  <li key={def.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(def.id)}
                      className="w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-3/60"
                    >
                      {/* Desktop row */}
                      <div className="hidden items-center gap-3 lg:flex">
                        <span className="flex w-[220px] shrink-0 items-center gap-2">
                          <Beacon status={runtime.status} />
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium text-ink">
                              {def.name}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-ink-4">
                              {def.hostname}
                            </span>
                          </span>
                        </span>
                        <span className="w-[92px] shrink-0">
                          <StatusBadge status={runtime.status} />
                        </span>
                        <span className="tabnum w-[78px] shrink-0 text-right font-mono text-[11.5px] text-ink-2">
                          {formatLatency(runtime.metrics.latencyMs ?? 0)}
                        </span>
                        <span className="tabnum w-[70px] shrink-0 text-right font-mono text-[11.5px] text-ink-3">
                          {formatCompact(runtime.metrics.rps ?? 0)}/s
                        </span>
                        <span
                          className={cx(
                            "tabnum w-[68px] shrink-0 text-right font-mono text-[11.5px]",
                            (runtime.metrics.errorRate ?? 0) > def.slo.errorRate
                              ? "text-warn"
                              : "text-ink-3",
                          )}
                        >
                          {formatPercent(runtime.metrics.errorRate ?? 0, 2)}
                        </span>
                        <span className="tabnum w-[72px] shrink-0 text-right font-mono text-[11.5px] text-ink-3">
                          {formatAvailability(availability)}
                        </span>
                        <span className="w-[60px] shrink-0">
                          <Sparkline
                            values={sparkSeries(state, def.id, "latencyMs", 28)}
                            tone={tone}
                            width={54}
                            height={16}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">
                          {def.owner}
                          <span className="text-ink-4"> · {def.team}</span>
                        </span>
                        <span className="tabnum w-[130px] shrink-0 truncate text-right font-mono text-[10.5px] text-ink-4">
                          {deployment
                            ? `${deployment.version} · ${formatRelative(deployment.deployedAt, state.clock)}`
                            : `v${def.version.replace(/^[a-z-]+/, "")}`}
                        </span>
                      </div>

                      {/* Stacked row for tablet and mobile */}
                      <div className="lg:hidden">
                        <div className="flex items-center gap-2">
                          <Beacon status={runtime.status} />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                            {def.name}
                          </span>
                          <StatusBadge status={runtime.status} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-4 font-mono text-[11px] text-ink-3">
                          <span className="tabnum">
                            <span className="text-ink-4">lat</span>{" "}
                            {formatLatency(runtime.metrics.latencyMs ?? 0)}
                          </span>
                          <span className="tabnum">
                            <span className="text-ink-4">rps</span>{" "}
                            {formatCompact(runtime.metrics.rps ?? 0)}
                          </span>
                          <span className="tabnum">
                            <span className="text-ink-4">err</span>{" "}
                            {formatPercent(runtime.metrics.errorRate ?? 0, 2)}
                          </span>
                          <span className="truncate text-ink-4">{def.team}</span>
                        </div>
                        <span className="sr-only">{STATUS_LABEL[runtime.status]}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      <ServiceDrawer serviceId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export default function ServicesPage() {
  // useSearchParams needs a Suspense boundary so the route can still prerender.
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <ServicesContent />
    </Suspense>
  );
}
