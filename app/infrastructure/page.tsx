"use client";

import { useMemo, useState } from "react";
import { cx, formatLatency, formatPercent, STATUS_LABEL } from "@/lib/format";
import { statusRank } from "@/lib/sim/metrics";
import { dependentsOf, getService, SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { ServiceDrawer } from "@/components/services/service-drawer";
import { TopologyLegend, TopologyMap } from "@/components/topology/topology-map";
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
import type { ServiceId } from "@/lib/sim/types";

/**
 * Infrastructure topology.
 *
 * Selecting a node dims everything except its immediate neighbours, which turns
 * the map into a blast-radius tool: you can see at a glance what a failing
 * service takes with it, and what it depends on in turn.
 */
export default function InfrastructurePage() {
  const [focused, setFocused] = useState<ServiceId | null>(null);
  const [drawerService, setDrawerService] = useState<ServiceId | null>(null);

  const services = useSimStore((s) => s.state.services);

  const unhealthy = useMemo(
    () =>
      SERVICES.map((def) => ({ def, runtime: services[def.id] }))
        .filter((s) => s.runtime.status !== "healthy")
        .sort((a, b) => statusRank(b.runtime.status) - statusRank(a.runtime.status)),
    [services],
  );

  const focusedDef = focused ? getService(focused) : null;
  const focusedRuntime = focused ? services[focused] : null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="Infrastructure Topology"
        description="The live dependency graph for Meridian Cloud. Edge colour follows the health of the services it connects, and selecting a node isolates its blast radius."
        actions={
          focused ? (
            <Button variant="secondary" size="sm" onClick={() => setFocused(null)}>
              Clear selection
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* min-w-0 is load-bearing: without it the grid item sizes to the map's
            620px minimum and pushes the whole page into horizontal overflow
            instead of letting the map scroll inside its own panel. */}
        <Panel className="flex min-w-0 flex-col">
          <PanelHeader
            title="Service dependency map"
            subtitle="Request flow runs top to bottom: edge → routing → application → data"
            meta={`${SERVICES.length} nodes`}
          />
          <div className="min-h-0 flex-1 overflow-x-auto p-5 sm:p-7">
            {/* A generous minimum width keeps labels from colliding on
                narrow screens; the container scrolls rather than compressing. */}
            <TopologyMap
              selected={focused}
              onSelect={(id) => setFocused((current) => (current === id ? null : id))}
              className="h-[420px] min-w-[620px] sm:h-[500px]"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <TopologyLegend />
            <p className="text-[10.5px] text-ink-4">Select a node to isolate its dependencies</p>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          {/* Selected node */}
          <Panel>
            <PanelHeader title={focusedDef ? focusedDef.name : "Node details"} />
            {!focusedDef || !focusedRuntime ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12.5px] text-ink-3">No node selected</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">
                  Click any service in the map to see its status, dependencies and the services
                  that would be affected if it failed.
                </p>
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={focusedRuntime.status} />
                  <span className="font-mono text-[11px] text-ink-4">{focusedDef.ip}</span>
                </div>

                {focusedRuntime.reason ? (
                  <p
                    className={cx(
                      "mb-3 rounded-md border px-2.5 py-2 text-[11.5px] leading-snug",
                      focusedRuntime.status === "degraded"
                        ? "border-warn/25 bg-warn/8 text-warn"
                        : "border-crit/25 bg-crit/8 text-crit",
                    )}
                  >
                    {focusedRuntime.reason}
                  </p>
                ) : null}

                <DetailList>
                  <DetailRow label="Tier" value={focusedDef.tier} />
                  <DetailRow label="Team" value={focusedDef.team} />
                  <DetailRow
                    label="Latency"
                    value={formatLatency(focusedRuntime.metrics.latencyMs ?? 0)}
                    mono
                  />
                  <DetailRow
                    label="Error rate"
                    value={formatPercent(focusedRuntime.metrics.errorRate ?? 0, 2)}
                    mono
                  />
                  <DetailRow
                    label="Hostname"
                    value={<span className="text-[10.5px]">{focusedDef.hostname}</span>}
                    mono
                  />
                </DetailList>

                <div className="mt-3 grid gap-3">
                  <NeighbourList
                    label="Depends on"
                    ids={[...focusedDef.dependencies, ...(focusedDef.softDependencies ?? [])]}
                    emptyLabel="No upstream dependencies"
                  />
                  <NeighbourList
                    label="Blast radius if this fails"
                    ids={dependentsOf(focusedDef.id)}
                    emptyLabel="Nothing depends on this service"
                  />
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setDrawerService(focusedDef.id)}
                >
                  Open full service detail
                </Button>
              </div>
            )}
          </Panel>

          {/* Problem list */}
          <Panel className="flex min-h-0 flex-1 flex-col">
            <PanelHeader
              title="Needs attention"
              meta={unhealthy.length > 0 ? `${unhealthy.length}` : undefined}
            />
            {unhealthy.length === 0 ? (
              <div className="flex items-center gap-2.5 px-4 py-5">
                <Beacon status="healthy" />
                <p className="text-[12.5px] text-ink-3">
                  Every node is reporting healthy.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line overflow-y-auto">
                {unhealthy.map(({ def, runtime }) => (
                  <li key={def.id}>
                    <button
                      type="button"
                      onClick={() => setFocused(def.id)}
                      className="w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-3/60"
                    >
                      <div className="flex items-center gap-2">
                        <Beacon status={runtime.status} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                          {def.name}
                        </span>
                        <span className="sr-only">{STATUS_LABEL[runtime.status]}</span>
                      </div>
                      {runtime.reason ? (
                        <p className="mt-0.5 pl-4 text-[11px] leading-snug text-ink-4">
                          {runtime.reason}
                        </p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <ServiceDrawer serviceId={drawerService} onClose={() => setDrawerService(null)} />
    </div>
  );
}

function NeighbourList({
  label,
  ids,
  emptyLabel,
}: {
  label: string;
  ids: ServiceId[];
  emptyLabel: string;
}) {
  const services = useSimStore((s) => s.state.services);

  return (
    <div>
      <SectionLabel className="mb-1.5 block">{label}</SectionLabel>
      {ids.length === 0 ? (
        <p className="text-[11.5px] text-ink-4">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const runtime = services[id];
            return (
              <li
                key={id}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-3/60 px-1.5 py-1"
              >
                <Beacon status={runtime.status} />
                <span className="text-[11px] text-ink-2">{getService(id).name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
