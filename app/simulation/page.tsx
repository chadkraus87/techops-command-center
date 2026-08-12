"use client";

import { useMemo, useState } from "react";
import { CircleSlash, Trophy } from "lucide-react";
import { cx, formatDuration, formatPercent } from "@/lib/format";
import { activeIncident } from "@/lib/sim/engine";
import { summariseFleet } from "@/lib/sim/metrics";
import { highestRank, usePreferences } from "@/lib/store/prefs";
import { useSimStore } from "@/lib/store/sim-store";
import { IncidentTimeline } from "@/components/incidents/incident-timeline";
import { InvestigationPanel } from "@/components/simulation/investigation";
import { ScenarioPicker } from "@/components/simulation/scenario-picker";
import { ScoreReport } from "@/components/simulation/score-report";
import { ConfirmDialog } from "@/components/ui/overlay";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  Button,
  Panel,
  PanelHeader,
  SectionLabel,
  SeverityPill,
} from "@/components/ui/primitives";

/**
 * Simulation Center.
 *
 * Three states in one route — pick a scenario, work the incident, read the
 * report. Keeping them on one URL means the visitor never loses their place,
 * and the transition between states is itself part of the narrative.
 */
export default function SimulationPage() {
  const state = useSimStore((s) => s.state);
  const abortIncident = useSimStore((s) => s.abortIncident);
  const { prefs, loaded } = usePreferences();
  const [confirmAbort, setConfirmAbort] = useState(false);

  const incident = activeIncident(state);
  const fleet = summariseFleet(state.services);
  const resolved = incident?.status === "resolved";

  const elapsed = state.active?.elapsed ?? 0;
  const bestRank = loaded ? highestRank(prefs.results) : null;

  const impactedServices = useMemo(
    () =>
      Object.values(state.services).filter((s) => s.status !== "healthy").length,
    [state.services],
  );

  // --- No active incident: choose one -----------------------------------
  if (!incident) {
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <PageIntro
          title="Simulation Center"
          description="Trigger a realistic incident and work it end to end: read the evidence, diagnose the root cause, apply remediation and restore service. Each scenario is scored."
          meta={
            bestRank ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">
                <Trophy size={11} aria-hidden="true" />
                Best rank: {bestRank}
              </span>
            ) : undefined
          }
        />

        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
          <Beacon status={fleet.status === "operational" ? "healthy" : "degraded"} />
          <p className="min-w-0 flex-1 text-[12.5px] text-ink-3">
            {fleet.status === "operational" ? (
              <>
                Environment is healthy — {fleet.servicesOnline} of {fleet.servicesTotal} services
                nominal. Select a scenario to begin.
              </>
            ) : (
              <>
                Environment is still settling from a previous run. {impactedServices} service
                {impactedServices === 1 ? "" : "s"} not yet at baseline.
              </>
            )}
          </p>
        </div>

        <ScenarioPicker />

        {loaded && prefs.results.length > 0 ? (
          <Panel>
            <PanelHeader title="Your results" subtitle="Personal bests, stored in this browser" />
            <ul className="divide-y divide-line">
              {[...prefs.results]
                .sort((a, b) => b.score - a.score)
                .map((result) => (
                  <li
                    key={result.scenarioId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
                      {result.scenarioId
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ")}
                    </span>
                    <span className="text-[11.5px] text-accent">{result.rank}</span>
                    {result.timeToResolutionSeconds !== null ? (
                      <span className="tabnum font-mono text-[10.5px] text-ink-4">
                        {formatDuration(result.timeToResolutionSeconds)}
                      </span>
                    ) : null}
                    <span className="tabnum w-10 shrink-0 text-right font-mono text-[13px] font-semibold text-ink">
                      {result.score}
                    </span>
                  </li>
                ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    );
  }

  // --- Resolved: show the report ----------------------------------------
  if (resolved) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <PageIntro
          title="Post-Incident Report"
          description={`${incident.id} · ${incident.title}`}
        />
        <ScoreReport incident={incident} />
      </div>
    );
  }

  // --- Active: work the incident ----------------------------------------
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      {/* Incident banner */}
      <Panel className="overflow-hidden">
        <div
          className={cx(
            "relative border-l-2 px-5 py-4",
            incident.severity === "SEV-1" ? "border-l-crit" : "border-l-warn",
          )}
        >
          <div
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent",
              incident.severity === "SEV-1" ? "from-crit/8" : "from-warn/8",
            )}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityPill severity={incident.severity} />
                <span className="tabnum font-mono text-[11.5px] text-ink-4">{incident.id}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 px-2 py-0.5 text-[10.5px] capitalize text-ink-2">
                  <span
                    className={cx(
                      "beacon",
                      incident.status === "monitoring" ? "bg-warn" : "bg-crit beacon-pulse",
                    )}
                    aria-hidden="true"
                  />
                  {incident.status}
                </span>
              </div>
              <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
                {incident.title}
              </h2>
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
                {incident.customerImpact}
              </p>
            </div>

            <div className="flex items-start gap-5">
              <div>
                <p className="text-[10.5px] text-ink-4">Elapsed</p>
                <p className="tabnum mt-0.5 font-mono text-[19px] font-semibold text-ink">
                  {formatDuration(elapsed)}
                </p>
              </div>
              <div>
                <p className="text-[10.5px] text-ink-4">Impacted</p>
                <p className="tabnum mt-0.5 font-mono text-[19px] font-semibold text-warn">
                  {impactedServices}
                </p>
              </div>
              <div className="hidden sm:block">
                <p className="text-[10.5px] text-ink-4">Error rate</p>
                <p className="tabnum mt-0.5 font-mono text-[19px] font-semibold text-crit">
                  {formatPercent(fleet.errorRate, 1)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-1"
                icon={<CircleSlash size={13} />}
                onClick={() => setConfirmAbort(true)}
              >
                End incident
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <InvestigationPanel incident={incident} />

        <Panel className="flex max-h-[calc(100dvh-220px)] flex-col xl:sticky xl:top-[72px]">
          <PanelHeader
            title="Incident timeline"
            meta={`${incident.timeline.length}`}
            subtitle="Live — newest at the bottom"
          />
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <IncidentTimeline events={incident.timeline} startedAt={incident.startedAt} dense />
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <SectionLabel>
              Affected services: {incident.affectedServices.length}
            </SectionLabel>
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmAbort}
        onClose={() => setConfirmAbort(false)}
        onConfirm={abortIncident}
        title="End this incident?"
        description="Services return to baseline immediately and the run is recorded as abandoned rather than resolved. Your saved best scores are untouched."
        confirmLabel="End incident"
        destructive
      />
    </div>
  );
}
