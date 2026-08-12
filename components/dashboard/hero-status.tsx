"use client";

import Link from "next/link";
import { ArrowUpRight, Zap } from "lucide-react";
import {
  cx,
  formatAvailability,
  formatCompact,
  formatLatency,
  formatPercent,
  STATUS_BG_CLASS,
  STATUS_LABEL,
} from "@/lib/format";
import { summariseFleet } from "@/lib/sim/metrics";
import { SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Sparkline, StatTile } from "@/components/charts";
import { Beacon } from "@/components/ui/primitives";
import type { HealthStatus } from "@/lib/sim/types";

/**
 * The hero.
 *
 * This is the thirty-second impression, so it carries the three things that
 * matter most and nothing else: whether the system is up, the numbers that
 * prove it, and one obvious thing to click. The health strip along the bottom
 * is a per-service heartbeat — fifteen segments that turn colour together
 * during an incident, which reads instantly at any size.
 */

const HERO_TONE: Record<"operational" | "degraded" | "major-incident", string> = {
  operational: "from-ok/10",
  degraded: "from-warn/12",
  "major-incident": "from-crit/14",
};

const STATUS_TITLE = {
  operational: "All Systems Operational",
  degraded: "Degraded Performance",
  "major-incident": "Major Incident",
};

export function HeroStatus() {
  const services = useSimStore((s) => s.state.services);
  const globalHistory = useSimStore((s) => s.state.globalHistory);
  const activeIncident = useSimStore((s) =>
    s.state.incidents.find((i) => i.status !== "resolved"),
  );
  const openAlerts = useSimStore((s) => s.state.alerts.filter((a) => a.resolvedAt === null).length);
  const openTickets = useSimStore(
    (s) => s.state.tickets.filter((t) => t.status === "new" || t.status === "open").length,
  );

  const fleet = summariseFleet(services);
  const heroStatus: HealthStatus =
    fleet.status === "operational" ? "healthy" : fleet.status === "degraded" ? "degraded" : "critical";

  return (
    <section
      aria-label="System status"
      className="panel relative overflow-hidden"
    >
      {/* Status-tinted wash. Subtle enough to read as lighting, not decoration. */}
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-80 transition-colors duration-1000",
          HERO_TONE[fleet.status],
        )}
      />

      <div className="relative grid gap-px lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Left: the headline */}
        <div className="flex flex-col justify-between gap-5 p-5 sm:p-6">
          <div>
            <div className="flex items-center gap-2">
              <Beacon status={heroStatus} className="h-2 w-2" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">
                Meridian Cloud · Production · us-east-1
              </span>
            </div>

            <h2 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">
              {STATUS_TITLE[fleet.status]}
            </h2>

            <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-ink-3">
              {activeIncident ? (
                <>
                  <span className="font-medium text-ink-2">{activeIncident.id}</span> ·{" "}
                  {activeIncident.title} — {activeIncident.customerImpact}
                </>
              ) : (
                <>
                  All {fleet.servicesTotal} services are reporting healthy across every region.
                  Metrics are within SLO and there are no active incidents.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {activeIncident ? (
              <Link
                href="/simulation"
                className="inline-flex items-center gap-1.5 rounded-md border border-crit/30 bg-crit/12 px-3.5 py-2 text-[13px] font-medium text-crit transition-colors hover:bg-crit/20"
              >
                <span className="beacon beacon-pulse bg-crit" aria-hidden="true" />
                Investigate incident
                <ArrowUpRight size={14} />
              </Link>
            ) : (
              <Link
                href="/simulation"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_4px_12px_-4px_rgba(91,140,255,0.6)] transition-all hover:bg-[#6d99ff] active:translate-y-px"
              >
                <Zap size={14} />
                Start incident simulation
              </Link>
            )}
            <Link
              href="/infrastructure"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-4"
            >
              View topology
            </Link>
          </div>
        </div>

        {/* Right: the proof */}
        <div className="grid grid-cols-2 border-t border-line lg:w-[420px] lg:border-l lg:border-t-0 xl:w-[480px]">
          <StatTile
            className="border-b border-r border-line"
            label="Uptime (30d)"
            value={formatAvailability(fleet.availability)}
            tone="ok"
          />
          <StatTile
            className="border-b border-line"
            label="Requests"
            value={formatCompact(fleet.totalRps)}
            unit="/sec"
            tone="accent"
            sparkline={globalHistory.rps.slice(-40)}
          />
          <StatTile
            className="border-r border-line"
            label="Avg latency"
            value={formatLatency(fleet.avgLatency)}
            tone={fleet.avgLatency > 400 ? "warn" : "accent"}
            sparkline={globalHistory.latency.slice(-40)}
          />
          <StatTile
            label="Error rate"
            value={formatPercent(fleet.errorRate, fleet.errorRate > 0.01 ? 1 : 2)}
            tone={fleet.errorRate > 0.02 ? "crit" : fleet.errorRate > 0.005 ? "warn" : "ok"}
            sparkline={globalHistory.errorRate.slice(-40)}
          />
        </div>
      </div>

      {/* Per-service heartbeat strip */}
      <div className="relative border-t border-line px-5 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">
            Service health
          </span>
          <div className="flex items-center gap-3 text-[10.5px] text-ink-4">
            <span className="tabnum">
              <span className="text-ok">{fleet.servicesTotal - fleet.degradedCount - fleet.criticalCount}</span> healthy
            </span>
            {fleet.degradedCount > 0 ? (
              <span className="tabnum">
                <span className="text-warn">{fleet.degradedCount}</span> degraded
              </span>
            ) : null}
            {fleet.criticalCount > 0 ? (
              <span className="tabnum">
                <span className="text-crit">{fleet.criticalCount}</span> critical
              </span>
            ) : null}
            <span className="tabnum hidden sm:inline">
              {openAlerts} alerts · {openTickets} tickets
            </span>
          </div>
        </div>

        <ul className="mt-2 flex gap-[3px]">
          {SERVICES.map((service) => {
            const runtime = services[service.id];
            return (
              <li key={service.id} className="group relative min-w-0 flex-1">
                <Link
                  href={`/services?service=${service.id}`}
                  className="block"
                  aria-label={`${service.name}: ${STATUS_LABEL[runtime.status]}`}
                >
                  <span
                    className={cx(
                      "block h-1.5 rounded-full transition-all duration-500 group-hover:h-2.5",
                      STATUS_BG_CLASS[runtime.status],
                      runtime.status === "healthy" ? "opacity-55" : "opacity-100",
                    )}
                  />
                </Link>
                {/* Hover label — kept out of the layout so the strip stays thin */}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded border border-line bg-surface-4 px-2 py-1 text-[10.5px] text-ink shadow-lg group-hover:block">
                  {service.name} · {STATUS_LABEL[runtime.status]}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Compact fleet sparkline row used on narrower pages. */
export function FleetPulse() {
  const globalHistory = useSimStore((s) => s.state.globalHistory);
  return <Sparkline values={globalHistory.rps.slice(-48)} tone="accent" width={120} height={26} />;
}
