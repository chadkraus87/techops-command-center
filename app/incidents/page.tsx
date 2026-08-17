"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Siren } from "lucide-react";
import { cx, formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { getScenario } from "@/lib/sim/scenarios";
import { scoreIncident } from "@/lib/sim/scoring";
import { serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { IncidentReplay } from "@/components/incidents/incident-replay";
import { IncidentTimeline } from "@/components/incidents/incident-timeline";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  EmptyState,
  Panel,
  PanelHeader,
  SectionLabel,
  SeverityPill,
  SkeletonRows,
  ToggleGroup,
} from "@/components/ui/primitives";
import type { IncidentStatus } from "@/lib/sim/types";

/**
 * Incident Management.
 *
 * The record of what happened, as opposed to the Simulation Center's live
 * workflow. Root cause and resolution are withheld until an incident is closed —
 * showing them on an open incident would hand over the answer to a scenario the
 * visitor may still be working.
 */

const STATUS_META: Record<IncidentStatus, { label: string; className: string }> = {
  investigating: { label: "Investigating", className: "border-crit/30 bg-crit/10 text-crit" },
  identified: { label: "Identified", className: "border-warn/30 bg-warn/10 text-warn" },
  monitoring: { label: "Monitoring", className: "border-info/30 bg-info/10 text-info" },
  resolved: { label: "Resolved", className: "border-ok/30 bg-ok/10 text-ok" },
};

type Filter = "all" | "active" | "resolved";

function IncidentsContent() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");

  const incidents = useSimStore((s) => s.state.incidents);
  const clock = useSimStore((s) => s.state.clock);

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(idParam);

  const visible = useMemo(
    () =>
      incidents.filter((incident) => {
        if (filter === "active") return incident.status !== "resolved";
        if (filter === "resolved") return incident.status === "resolved";
        return true;
      }),
    [incidents, filter],
  );

  const selected =
    incidents.find((i) => i.id === selectedId) ?? visible[0] ?? incidents[0] ?? null;

  if (incidents.length === 0) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
        <PageIntro
          title="Incident Management"
          description="Active and historic incidents with severity, affected services, full timelines and post-incident analysis."
        />
        <Panel>
          <EmptyState
            icon={<Siren size={16} />}
            title="No incidents recorded"
            description="The environment has been healthy for this session. Trigger a scenario in the Simulation Center to create an incident with a live timeline."
            action={
              <Link
                href="/simulation"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#6d99ff]"
              >
                Open Simulation Center
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <PageIntro
        title="Incident Management"
        description="Active and historic incidents with severity, affected services, full timelines and post-incident analysis."
        actions={
          <ToggleGroup
            label="Filter incidents"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* List */}
        <Panel className="overflow-hidden">
          <PanelHeader title="Incidents" meta={`${visible.length}`} />
          {visible.length === 0 ? (
            <EmptyState title="Nothing in this view" description="Adjust the filter above." />
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((incident) => {
                const isSelected = selected?.id === incident.id;
                return (
                  <li key={incident.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(incident.id)}
                      aria-current={isSelected ? "true" : undefined}
                      className={cx(
                        "w-full px-4 py-3 text-left transition-colors",
                        isSelected ? "bg-surface-4" : "hover:bg-surface-3/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <SeverityPill severity={incident.severity} />
                        <span className="tabnum font-mono text-[10.5px] text-ink-4">
                          {incident.id}
                        </span>
                        {incident.status !== "resolved" ? (
                          <Beacon status="critical" className="ml-auto" />
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink">
                        {incident.title}
                      </p>
                      <p className="tabnum mt-1 font-mono text-[10.5px] text-ink-4">
                        {formatRelative(incident.startedAt, clock)} ·{" "}
                        {STATUS_META[incident.status].label}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Detail */}
        {selected ? (
          <div className="flex flex-col gap-4">
            <Panel>
              <div className="border-b border-line px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityPill severity={selected.severity} />
                  <span className="tabnum font-mono text-[11.5px] text-ink-4">{selected.id}</span>
                  <span
                    className={cx(
                      "rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                      STATUS_META[selected.status].className,
                    )}
                  >
                    {STATUS_META[selected.status].label}
                  </span>
                </div>
                <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">
                  {selected.title}
                </h2>
                <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
                  {selected.customerImpact}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
                {[
                  { label: "Started", value: formatDateTime(selected.startedAt) },
                  {
                    label: "Duration",
                    value: formatDuration(
                      ((selected.resolvedAt ?? clock) - selected.startedAt) / 1000,
                    ),
                  },
                  {
                    label: "Affected",
                    value: `${selected.affectedServices.length} services`,
                  },
                  {
                    label: "Timeline",
                    value: `${selected.timeline.length} events`,
                  },
                ].map((stat) => (
                  <div key={stat.label} className="bg-surface-2 px-4 py-2.5">
                    <p className="text-[10.5px] text-ink-4">{stat.label}</p>
                    <p className="tabnum mt-0.5 truncate font-mono text-[12px] text-ink-2">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4">
                <SectionLabel className="mb-1.5 block">Affected services</SectionLabel>
                <ul className="flex flex-wrap gap-1.5">
                  {selected.affectedServices.map((id) => (
                    <ServiceChip key={id} id={id} />
                  ))}
                </ul>
              </div>

              {/* The answer, only once the incident is closed. */}
              {selected.status === "resolved" ? (
                <div className="space-y-4 border-t border-line px-5 py-4">
                  <div>
                    <SectionLabel className="mb-1.5 block">Root cause</SectionLabel>
                    <p className="text-[12.5px] leading-relaxed text-ink-2">
                      {selected.rootCause}
                    </p>
                  </div>
                  <div>
                    <SectionLabel className="mb-1.5 block">Resolution</SectionLabel>
                    <p className="text-[12.5px] leading-relaxed text-ink-2">
                      {selected.resolution}
                    </p>
                  </div>
                  <div>
                    <SectionLabel className="mb-1.5 block">Contributing evidence</SectionLabel>
                    <ul className="space-y-1">
                      {getScenario(selected.scenarioId).keyEvidence.map((evidence) => (
                        <li
                          key={evidence}
                          className="flex gap-2 text-[12px] leading-relaxed text-ink-3"
                        >
                          <span
                            className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent"
                            aria-hidden="true"
                          />
                          {evidence}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-5 border-t border-line pt-3">
                    <ScoreStat label="Score" value={`${scoreIncident(selected).total}/100`} />
                    <ScoreStat label="Rank" value={scoreIncident(selected).rank} />
                    <ScoreStat
                      label="Attempts"
                      value={String(scoreIncident(selected).diagnosisAttempts)}
                    />
                  </div>
                </div>
              ) : (
                <div className="border-t border-line px-5 py-4">
                  <div className="rounded-md border border-line bg-surface-3/50 px-3.5 py-3">
                    <p className="text-[12px] font-medium text-ink-2">
                      Root cause not yet established
                    </p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">
                      This incident is still open. Work it in the Simulation Center — the analysis
                      appears here once it is resolved.
                    </p>
                    <Link
                      href="/simulation"
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-4"
                    >
                      Continue investigation
                    </Link>
                  </div>
                </div>
              )}
            </Panel>

            {selected.status === "resolved" ? <IncidentReplay incident={selected} /> : null}

            <Panel>
              <PanelHeader
                title="Timeline"
                subtitle="Every alert, action and state change in order"
                meta={`${selected.timeline.length}`}
              />
              <div className="max-h-[520px] overflow-y-auto py-2">
                <IncidentTimeline
                  events={selected.timeline}
                  startedAt={selected.startedAt}
                />
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ServiceChip({ id }: { id: Parameters<typeof serviceName>[0] }) {
  const status = useSimStore((s) => s.state.services[id]?.status ?? "healthy");
  return (
    <li className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-3/60 px-2 py-1">
      <Beacon status={status} />
      <span className="text-[11px] text-ink-2">{serviceName(id)}</span>
    </li>
  );
}

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-ink-4">{label}</p>
      <p className="tabnum mt-0.5 font-mono text-[13px] font-medium text-ink">{value}</p>
    </div>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <IncidentsContent />
    </Suspense>
  );
}
