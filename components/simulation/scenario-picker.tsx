"use client";

import { useState } from "react";
import { ChevronRight, Play, Trophy } from "lucide-react";
import { cx } from "@/lib/format";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { serviceName } from "@/lib/sim/services";
import { bestFor, usePreferences } from "@/lib/store/prefs";
import { useSimStore } from "@/lib/store/sim-store";
import { Button, Panel, SectionLabel, SeverityPill } from "@/components/ui/primitives";
import type { Scenario } from "@/lib/sim/types";

/**
 * Scenario selection.
 *
 * Each card states difficulty, severity and blast radius up front but never the
 * cause — the whole exercise is worthless if the card gives the answer away. The
 * personal best is shown per scenario so there is a reason to replay one you
 * have already solved.
 */

const DIFFICULTY_CLASS = {
  starter: "border-ok/25 bg-ok/10 text-ok",
  intermediate: "border-warn/25 bg-warn/10 text-warn",
  advanced: "border-crit/25 bg-crit/10 text-crit",
};

export function ScenarioPicker() {
  const triggerScenario = useSimStore((s) => s.triggerScenario);
  const { prefs, loaded } = usePreferences();
  const [expanded, setExpanded] = useState<string | null>(SCENARIOS[0]?.id ?? null);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {SCENARIOS.map((scenario) => {
        const isExpanded = expanded === scenario.id;
        const best = loaded ? bestFor(prefs.results, scenario.id) : undefined;

        return (
          <Panel
            key={scenario.id}
            className={cx(
              "flex flex-col transition-colors duration-200",
              isExpanded && "ring-1 ring-accent/30",
            )}
          >
            <button
              type="button"
              onClick={() => setExpanded(isExpanded ? null : scenario.id)}
              aria-expanded={isExpanded}
              className="flex items-start gap-3 px-4 py-3.5 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-semibold tracking-tight text-ink">
                    {scenario.title}
                  </h3>
                  <SeverityPill severity={scenario.severity} />
                  <span
                    className={cx(
                      "rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider",
                      DIFFICULTY_CLASS[scenario.difficulty],
                    )}
                  >
                    {scenario.difficulty}
                  </span>
                  {best ? (
                    <span className="inline-flex items-center gap-1 rounded border border-accent/25 bg-accent/10 px-1.5 py-px text-[9.5px] font-semibold text-accent">
                      <Trophy size={9} aria-hidden="true" />
                      {best.score}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
                  {scenario.summary}
                </p>
              </div>
              <ChevronRight
                size={16}
                className={cx(
                  "mt-0.5 shrink-0 text-ink-4 transition-transform duration-200",
                  isExpanded && "rotate-90",
                )}
                aria-hidden="true"
              />
            </button>

            {isExpanded ? (
              <div className="anim-fade-in border-t border-line px-4 py-3.5">
                <ScenarioBriefing scenario={scenario} />
                <Button
                  variant="primary"
                  size="md"
                  className="mt-4 w-full"
                  icon={<Play size={13} />}
                  onClick={() => triggerScenario(scenario.id)}
                >
                  Start simulation
                </Button>
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}

function ScenarioBriefing({ scenario }: { scenario: Scenario }) {
  return (
    <div className="space-y-3">
      <div>
        <SectionLabel className="mb-1 block">Expected impact</SectionLabel>
        <p className="text-[12px] leading-relaxed text-ink-2">{scenario.expectedImpact}</p>
      </div>

      <div>
        <SectionLabel className="mb-1 block">Customer impact</SectionLabel>
        <p className="text-[12px] leading-relaxed text-ink-2">{scenario.customerImpact}</p>
      </div>

      <div>
        <SectionLabel className="mb-1.5 block">
          Affected systems ({scenario.affectedServices.length})
        </SectionLabel>
        <ul className="flex flex-wrap gap-1.5">
          {scenario.affectedServices.map((id) => (
            <li
              key={id}
              className="rounded border border-line bg-surface-3/60 px-1.5 py-1 text-[10.5px] text-ink-3"
            >
              {serviceName(id)}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5">
        <span className="tabnum font-mono text-[10.5px] text-ink-4">
          Declares after {scenario.declareAfterSeconds}s
        </span>
        <span className="tabnum font-mono text-[10.5px] text-ink-4">
          {scenario.remediationOptions.length} remediation options
        </span>
        <span className="tabnum font-mono text-[10.5px] text-ink-4">
          {scenario.requiredRemediationIds.length} required step
          {scenario.requiredRemediationIds.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
