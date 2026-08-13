"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Award, Info, Link2Off, Zap } from "lucide-react";
import { cx, formatDuration } from "@/lib/format";
import { decodeResult, scenarioForShared } from "@/lib/sim/share";
import { RANKS } from "@/lib/sim/scoring";
import { useSimStore } from "@/lib/store/sim-store";
import { PageIntro } from "@/components/ui/page-intro";
import {
  EmptyState,
  Meter,
  Panel,
  SeverityPill,
  SkeletonRows,
} from "@/components/ui/primitives";

/**
 * A shared result.
 *
 * Read-only, decoded entirely from the URL — there is no backend and nothing is
 * looked up. The page is deliberately explicit that a shared score is unverified
 * (see lib/sim/share.ts): presenting an unsigned number as fact would be
 * dishonest, and saying so costs nothing.
 *
 * Its real job is conversion: someone arriving from a shared link should be one
 * click from running the same scenario themselves.
 */
function ResultContent() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get("r");
  const triggerScenario = useSimStore((s) => s.triggerScenario);
  const hasActive = useSimStore((s) => s.state.active !== null);

  const result = useMemo(() => decodeResult(encoded), [encoded]);

  if (!result) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col gap-4">
        <PageIntro
          title="Shared Result"
          description="This link should show someone's incident-response run."
        />
        <Panel>
          <EmptyState
            icon={<Link2Off size={16} />}
            title="That link could not be read"
            description="It is either incomplete, from an older version of the app, or was edited after it was created. Nothing is lost — you can run the scenario yourself."
            action={
              <Link
                href="/simulation"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#6d99ff]"
              >
                <Zap size={13} />
                Open Simulation Center
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const scenario = scenarioForShared(result);
  const rankIndex = RANKS.indexOf(result.rank);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <PageIntro
        title="Shared Result"
        description="Someone else's run of this scenario. Try it yourself and compare."
      />

      <Panel className="overflow-hidden">
        <div className="relative border-b border-line px-5 py-7 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/10 to-transparent"
          />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
              <Award size={12} aria-hidden="true" />
              {result.scenarioTitle}
            </span>

            <p className="tabnum mt-4 font-mono text-[52px] font-semibold leading-none tracking-tight text-ink sm:text-[64px]">
              {result.total}
              <span className="text-[24px] text-ink-4">/100</span>
            </p>

            <p className="mt-2 text-[16px] font-semibold tracking-tight text-accent">
              {result.rank}
            </p>

            <ol className="mx-auto mt-4 flex max-w-lg flex-wrap items-center justify-center gap-1">
              {RANKS.map((rank, index) => (
                <li
                  key={rank}
                  className={cx(
                    "rounded px-1.5 py-0.5 text-[9.5px] font-medium",
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

        <div className="grid gap-px bg-line sm:grid-cols-2">
          <SharedRow label="Diagnosis accuracy" value={result.diagnosisPoints} max={40} />
          <SharedRow label="Time to diagnosis" value={result.speedPoints} max={20} />
          <SharedRow label="Investigation" value={result.investigationPoints} max={15} />
          <SharedRow label="Remediation" value={result.remediationPoints} max={25} />
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          <Stat
            label="Time to resolve"
            value={
              result.timeToResolutionSeconds !== null
                ? formatDuration(result.timeToResolutionSeconds)
                : "—"
            }
          />
          <Stat label="Diagnosis attempts" value={String(result.diagnosisAttempts)} />
          <Stat label="Sources examined" value={String(result.evidenceViewedCount)} />
          <Stat
            label="Wasted actions"
            value={String(result.unnecessaryActionCount)}
            tone={result.unnecessaryActionCount > 0 ? "text-warn" : undefined}
          />
        </div>
      </Panel>

      {/* Conversion: the point of the page. */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityPill severity={scenario.severity} />
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            {scenario.title}
          </h2>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{scenario.summary}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/simulation"
            onClick={() => {
              if (!hasActive) triggerScenario(scenario.id);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_4px_12px_-4px_rgba(91,140,255,0.6)] transition-colors hover:bg-[#6d99ff]"
          >
            <Zap size={13} />
            {hasActive ? "Go to Simulation Center" : "Beat this score"}
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-4"
          >
            Explore the dashboard
          </Link>
        </div>
      </Panel>

      <p className="flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-ink-4">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Shared results are encoded in the link itself — there is no server storing them. That
          also means they are unverified: a link can be edited. Treat it as a conversation
          starter, not a leaderboard.
        </span>
      </p>
    </div>
  );
}

function SharedRow({ label, value, max }: { label: string; value: number; max: number }) {
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
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface-2 px-4 py-3">
      <p className="text-[10.5px] text-ink-4">{label}</p>
      <p className={cx("tabnum mt-0.5 font-mono text-[15px] font-medium", tone ?? "text-ink")}>
        {value}
      </p>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <ResultContent />
    </Suspense>
  );
}
