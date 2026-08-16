"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Award, Check, Link2, RotateCcw } from "lucide-react";
import { cx, formatDuration } from "@/lib/format";
import { getScenario } from "@/lib/sim/scenarios";
import { labelForAction, RANKS, scoreIncident } from "@/lib/sim/scoring";
import { buildShareUrl } from "@/lib/sim/share";
import { usePreferences } from "@/lib/store/prefs";
import { useSimStore } from "@/lib/store/sim-store";
import { Button, Meter, Panel, SectionLabel } from "@/components/ui/primitives";
import type { Incident, ScoreBreakdown } from "@/lib/sim/types";

/**
 * Post-incident report.
 *
 * Shown once the incident resolves. The breakdown matters more than the total:
 * a visitor should leave understanding *why* they scored what they did, and the
 * key-evidence list doubles as the answer key for anything they missed.
 */

export function ScoreReport({ incident }: { incident: Incident }) {
  const scenario = getScenario(incident.scenarioId);
  const score = scoreIncident(incident);
  const clearScenario = useSimStore((s) => s.clearScenario);
  const { recordResult } = usePreferences();

  // Persist the result exactly once, when the report first appears.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    recordResult({
      scenarioId: incident.scenarioId,
      score: score.total,
      rank: score.rank,
      completedAt: incident.resolvedAt ?? Date.now(),
      timeToResolutionSeconds: score.timeToResolutionSeconds,
    });
  }, [incident.scenarioId, incident.resolvedAt, score.total, score.rank, score.timeToResolutionSeconds, recordResult]);

  const rankIndex = RANKS.indexOf(score.rank);

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        {/* Headline */}
        <div className="relative border-b border-line px-5 py-6 text-center sm:py-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ok/10 to-transparent"
          />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] font-medium text-ok">
              <Award size={12} aria-hidden="true" />
              Incident resolved
            </span>

            <p className="tabnum mt-4 font-mono text-[52px] font-semibold leading-none tracking-tight text-ink sm:text-[64px]">
              {score.total}
              <span className="text-[24px] text-ink-4">/100</span>
            </p>

            <p className="mt-2 text-[16px] font-semibold tracking-tight text-accent">
              {score.rank}
            </p>

            {/* Rank ladder — shows what the next tier looks like */}
            <ol className="mx-auto mt-4 flex max-w-lg flex-wrap items-center justify-center gap-1">
              {RANKS.map((rank, index) => (
                <li
                  key={rank}
                  className={cx(
                    "rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors",
                    index === rankIndex
                      ? "bg-accent/15 text-accent"
                      : index < rankIndex
                        ? "text-ink-3"
                        : "text-ink-4/60",
                  )}
                >
                  {rank}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid gap-px bg-line sm:grid-cols-2">
          <ScoreRow
            label="Diagnosis accuracy"
            value={score.diagnosisPoints}
            max={40}
            detail={
              score.diagnosisAttempts === 1
                ? "Correct on the first attempt"
                : `${score.diagnosisAttempts} attempts before the correct cause`
            }
          />
          <ScoreRow
            label="Time to diagnosis"
            value={score.speedPoints}
            max={20}
            detail={
              score.timeToDiagnosisSeconds !== null
                ? `Diagnosed in ${formatDuration(score.timeToDiagnosisSeconds)}`
                : "Never diagnosed"
            }
          />
          <ScoreRow
            label="Investigation"
            value={score.investigationPoints}
            max={15}
            detail={`${score.evidenceViewedCount} distinct sources examined`}
          />
          <ScoreRow
            label="Remediation"
            value={score.remediationPoints}
            max={25}
            detail={`${scenario.requiredRemediationIds.length} required step${
              scenario.requiredRemediationIds.length === 1 ? "" : "s"
            } completed`}
          />
        </div>

        {score.penalties > 0 ? (
          <div className="border-t border-line bg-crit/5 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <SectionLabel className="text-crit">Deductions</SectionLabel>
              <span className="tabnum font-mono text-[13px] font-semibold text-crit">
                −{score.penalties}
              </span>
            </div>

            {score.unnecessaryActions.length > 0 ? (
              <>
                <p className="mt-1.5 text-[11.5px] font-medium text-ink-2">
                  Unnecessary actions (−{score.penalties - score.hintPenalty})
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {score.unnecessaryActions.map((id) => (
                    <li key={id} className="text-[11.5px] text-ink-3">
                      · {labelForAction(incident, id)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                  In production, acting on healthy systems during an incident extends the outage
                  and can create a second one.
                </p>
              </>
            ) : null}

            {score.hintsRevealed > 0 ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                <span className="font-medium text-ink-2">
                  {score.hintsRevealed} hint{score.hintsRevealed === 1 ? "" : "s"} taken (−
                  {score.hintPenalty}).
                </span>{" "}
                Worth it — asking for direction costs less than guessing wrong.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* Post-mortem */}
      <Panel>
        <div className="space-y-4 p-5">
          <div>
            <SectionLabel className="mb-1.5 block">Root cause</SectionLabel>
            <p className="text-[12.5px] leading-relaxed text-ink-2">{incident.rootCause}</p>
          </div>

          <div>
            <SectionLabel className="mb-1.5 block">Resolution</SectionLabel>
            <p className="text-[12.5px] leading-relaxed text-ink-2">{incident.resolution}</p>
          </div>

          <div>
            <SectionLabel className="mb-1.5 block">Key evidence</SectionLabel>
            <ul className="space-y-1.5">
              {scenario.keyEvidence.map((evidence) => (
                <li
                  key={evidence}
                  className="flex gap-2.5 text-[12px] leading-relaxed text-ink-3"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  {evidence}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-4 border-t border-line pt-3">
            <Stat
              label="Time to resolution"
              value={
                score.timeToResolutionSeconds !== null
                  ? formatDuration(score.timeToResolutionSeconds)
                  : "—"
              }
            />
            <Stat label="Timeline events" value={String(incident.timeline.length)} />
            <Stat label="Actions taken" value={String(incident.investigation.actionsTaken.length)} />
            <Stat label="Severity" value={incident.severity} />
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ShareResult incident={incident} score={score} />
        <Button
          variant="primary"
          size="lg"
          icon={<RotateCcw size={14} />}
          onClick={clearScenario}
          className="flex-1"
        >
          Run another scenario
        </Button>
      </div>
    </div>
  );
}

/**
 * Copy a link to this run.
 *
 * The whole result lives in the URL, so there is nothing to store and no
 * account involved. Falls back to a selectable input where the clipboard API is
 * unavailable — an insecure context, or a browser that refuses the permission.
 */
function ShareResult({ incident, score }: { incident: Incident; score: ScoreBreakdown }) {
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const share = useCallback(async () => {
    const url = buildShareUrl(incident, score, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFallbackUrl(url);
    }
  }, [incident, score]);

  if (fallbackUrl) {
    return (
      <div className="flex-1">
        <label htmlFor="share-url" className="mb-1 block text-[11px] text-ink-3">
          Copy this link to share your result
        </label>
        <input
          id="share-url"
          readOnly
          value={fallbackUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[11px] text-ink outline-none"
        />
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      icon={copied ? <Check size={14} /> : <Link2 size={14} />}
      onClick={share}
      className="flex-1"
    >
      {copied ? "Link copied" : "Share result"}
    </Button>
  );
}

function ScoreRow({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
  const ratio = value / max;
  return (
    <div className="bg-surface-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        <span className="tabnum font-mono text-[13px] font-semibold text-ink">
          {value}
          <span className="text-ink-4">/{max}</span>
        </span>
      </div>
      <Meter
        className="mt-2"
        value={value}
        max={max}
        tone={ratio >= 0.8 ? "ok" : ratio >= 0.4 ? "warn" : "crit"}
        label={label}
      />
      <p className="mt-1.5 text-[11px] text-ink-4">{detail}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] text-ink-4">{label}</p>
      <p className="tabnum mt-0.5 font-mono text-[13px] font-medium text-ink">{value}</p>
    </div>
  );
}
