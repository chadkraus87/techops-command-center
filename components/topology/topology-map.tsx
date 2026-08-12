"use client";

import { useMemo } from "react";
import { cx, STATUS_LABEL, STATUS_TEXT_CLASS } from "@/lib/format";
import { statusRank } from "@/lib/sim/metrics";
import { SERVICES, TOPOLOGY_LAYOUT } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Beacon } from "@/components/ui/primitives";
import type { HealthStatus, ServiceId } from "@/lib/sim/types";

/**
 * Infrastructure topology.
 *
 * Rendered as HTML nodes positioned in percentage space with an SVG edge layer
 * underneath. That split is deliberate: SVG draws the connections crisply at any
 * size, while the nodes stay real HTML — so they are focusable, keyboard
 * reachable, and their text is selectable and never scales oddly.
 *
 * `vectorEffect="non-scaling-stroke"` keeps edge weight constant even though the
 * SVG viewBox is stretched to the container's aspect ratio.
 */

interface Edge {
  from: ServiceId;
  to: ServiceId;
  soft: boolean;
}

const EDGES: Edge[] = SERVICES.flatMap((service) => [
  ...service.dependencies.map((dep) => ({ from: service.id, to: dep, soft: false })),
  ...(service.softDependencies ?? []).map((dep) => ({ from: service.id, to: dep, soft: true })),
]);

const EDGE_STROKE: Record<HealthStatus, string> = {
  healthy: "var(--color-line)",
  degraded: "var(--color-warn)",
  critical: "var(--color-crit)",
  offline: "var(--color-crit)",
};

const NODE_RING: Record<HealthStatus, string> = {
  healthy: "border-line",
  degraded: "border-warn/50",
  critical: "border-crit/60",
  offline: "border-crit/60",
};

export function TopologyMap({
  selected,
  onSelect,
  compact = false,
  className,
}: {
  selected?: ServiceId | null;
  onSelect?: (id: ServiceId) => void;
  compact?: boolean;
  className?: string;
}) {
  const services = useSimStore((s) => s.state.services);

  // Edge health is the worse of its two endpoints — a connection is only as
  // good as the service answering on it.
  const edges = useMemo(
    () =>
      EDGES.map((edge) => {
        const from = services[edge.from]?.status ?? "healthy";
        const to = services[edge.to]?.status ?? "healthy";
        const status = statusRank(from) >= statusRank(to) ? from : to;
        return { ...edge, status };
      }),
    [services],
  );

  return (
    <div className={cx("relative w-full", className)}>
      {/* Edge layer */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {edges.map((edge) => {
          const a = TOPOLOGY_LAYOUT[edge.from];
          const b = TOPOLOGY_LAYOUT[edge.to];
          if (!a || !b) return null;
          const unhealthy = edge.status !== "healthy";
          const involved =
            selected != null && (edge.from === selected || edge.to === selected);

          return (
            <line
              key={`${edge.from}->${edge.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={EDGE_STROKE[edge.status]}
              strokeWidth={involved ? 2 : unhealthy ? 1.5 : 1}
              strokeDasharray={edge.soft ? "3 3" : unhealthy ? "4 3" : undefined}
              strokeOpacity={
                selected != null && !involved ? 0.25 : unhealthy ? 0.9 : involved ? 0.9 : 0.55
              }
              vectorEffect="non-scaling-stroke"
              className={cx(unhealthy && "animate-pulse")}
            />
          );
        })}
      </svg>

      {/* Node layer */}
      <ul className="relative h-full w-full list-none">
        {SERVICES.map((service) => {
          const position = TOPOLOGY_LAYOUT[service.id];
          const runtime = services[service.id];
          const isSelected = selected === service.id;
          const dimmed =
            selected != null &&
            !isSelected &&
            !service.dependencies.includes(selected) &&
            !(service.softDependencies ?? []).includes(selected) &&
            !SERVICES.find((s) => s.id === selected)?.dependencies.includes(service.id) &&
            !(SERVICES.find((s) => s.id === selected)?.softDependencies ?? []).includes(service.id);

          return (
            <li
              key={service.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(service.id)}
                aria-pressed={isSelected}
                aria-label={`${service.name}, ${STATUS_LABEL[runtime.status]}`}
                className={cx(
                  "group flex items-center gap-1.5 rounded-md border bg-surface-2/95 shadow-lg backdrop-blur-sm transition-all duration-300",
                  compact ? "px-1.5 py-1" : "px-2 py-1.5",
                  NODE_RING[runtime.status],
                  isSelected && "ring-2 ring-accent ring-offset-2 ring-offset-void",
                  dimmed ? "opacity-35" : "opacity-100",
                  onSelect && "hover:border-accent/50 hover:bg-surface-3",
                )}
              >
                <Beacon status={runtime.status} className={compact ? "h-1.5 w-1.5" : ""} />
                <span
                  className={cx(
                    "whitespace-nowrap font-medium tracking-tight",
                    compact ? "text-[9.5px]" : "text-[11px]",
                    runtime.status === "healthy" ? "text-ink-2" : STATUS_TEXT_CLASS[runtime.status],
                  )}
                >
                  {compact ? shortName(service.name) : service.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Trim names for the compact overview map, where space is tight. */
function shortName(name: string): string {
  return name
    .replace("Service", "")
    .replace("Primary ", "")
    .replace(" Pipeline", "")
    .replace(" Resolver", "")
    .replace(" Worker", "")
    .trim();
}

/** Legend explaining the edge vocabulary. */
export function TopologyLegend({ className }: { className?: string }) {
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      <li className="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line x1="0" y1="3" x2="18" y2="3" stroke="var(--color-line)" strokeWidth="1.5" />
        </svg>
        <span className="text-[10.5px] text-ink-4">Hard dependency</span>
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke="var(--color-line)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </svg>
        <span className="text-[10.5px] text-ink-4">Soft dependency</span>
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke="var(--color-warn)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
        <span className="text-[10.5px] text-ink-4">Degraded path</span>
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden="true">
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke="var(--color-crit)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
        <span className="text-[10.5px] text-ink-4">Failed path</span>
      </li>
    </ul>
  );
}
