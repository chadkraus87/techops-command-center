"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Lightbulb,
  LifeBuoy,
  Loader2,
  Network,
  ScrollText,
  Waypoints,
  Wrench,
  XCircle,
} from "lucide-react";
import { cx, formatDuration } from "@/lib/format";
import { getScenario } from "@/lib/sim/scenarios";
import { usePreferences } from "@/lib/store/prefs";
import { useSimStore } from "@/lib/store/sim-store";
import { Button, Panel, PanelHeader, SectionLabel } from "@/components/ui/primitives";
import type { Incident } from "@/lib/sim/types";

/**
 * The investigation workflow: gather evidence, commit to a diagnosis, remediate.
 *
 * Two deliberate design decisions:
 *  - Remediation is never gated on a correct diagnosis. Fixing something does
 *    fix it, whether or not you understood why — the score is what rewards
 *    understanding. Gating would be tidier and less honest.
 *  - A wrong diagnosis returns scenario-specific coaching that points at the
 *    evidence which rules it out, rather than saying "wrong". Being told *why*
 *    a hypothesis fails is the part that teaches.
 */

/** Where the evidence lives. Visiting these is what earns investigation points. */
const EVIDENCE_LINKS = [
  { href: "/logs", label: "Inspect logs", icon: ScrollText, hint: "Error messages name their cause" },
  { href: "/metrics", label: "Check metrics", icon: Activity, hint: "Compare against SLO lines" },
  { href: "/network", label: "Run diagnostics", icon: Network, hint: "ping, dig, traceroute" },
  { href: "/infrastructure", label: "Dependency map", icon: Waypoints, hint: "Trace the blast radius" },
  { href: "/alerts", label: "Active alerts", icon: AlertTriangle, hint: "What fired, and when" },
  { href: "/support", label: "Support queue", icon: LifeBuoy, hint: "The customer's view" },
];

export function InvestigationPanel({ incident }: { incident: Incident }) {
  const scenario = getScenario(incident.scenarioId);
  const active = useSimStore((s) => s.state.active);
  const diagnose = useSimStore((s) => s.diagnose);
  const remediate = useSimStore((s) => s.remediate);
  const takeHint = useSimStore((s) => s.takeHint);
  const { prefs, update } = usePreferences();

  const [selectedDiagnosis, setSelectedDiagnosis] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; text: string } | null>(null);

  const { investigation } = incident;
  const solved = investigation.correctDiagnosis;
  const pendingAction = active?.pendingAction ?? null;
  const recovering = active?.phase === "recovering" || active?.phase === "resolved";

  const submit = () => {
    if (!selectedDiagnosis) return;
    const result = diagnose(selectedDiagnosis);
    setFeedback({ correct: result.correct, text: result.feedback });
    if (result.correct) setSelectedDiagnosis(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Guidance */}
      <GuidancePanel
        scenario={scenario}
        hintsRevealed={investigation.hintsRevealed}
        guidedMode={prefs.guidedMode}
        onToggleGuided={() => update({ guidedMode: !prefs.guidedMode })}
        onTakeHint={takeHint}
        solved={solved}
      />

      {/* Evidence */}
      <Panel>
        <PanelHeader
          title="Gather evidence"
          subtitle="Investigate before you commit — thoroughness is scored"
          meta={`${investigation.evidenceViewed.length} viewed`}
        />
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
          {EVIDENCE_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group flex flex-col gap-1 bg-surface-2 px-3 py-3 transition-colors hover:bg-surface-3"
              >
                <span className="flex items-center gap-2">
                  <Icon size={13} className="shrink-0 text-accent" aria-hidden="true" />
                  <span className="text-[12px] font-medium text-ink">{link.label}</span>
                </span>
                <span className="text-[10.5px] leading-snug text-ink-4">{link.hint}</span>
              </Link>
            );
          })}
        </div>
      </Panel>

      {/* Diagnosis */}
      <Panel>
        <PanelHeader
          title="Submit diagnosis"
          subtitle={
            solved
              ? "Root cause confirmed — proceed to remediation"
              : "What is the underlying cause? Wrong answers cost points but return a hint."
          }
          meta={
            investigation.diagnosisAttempts.length > 0
              ? `${investigation.diagnosisAttempts.length} attempt${investigation.diagnosisAttempts.length === 1 ? "" : "s"}`
              : undefined
          }
        />

        <div className="p-4">
          {solved ? (
            <div className="flex items-start gap-2.5 rounded-md border border-ok/30 bg-ok/8 px-3 py-2.5">
              <CheckCircle2 size={15} className="mt-px shrink-0 text-ok" aria-hidden="true" />
              <div>
                <p className="text-[12.5px] font-medium text-ok">
                  {scenario.diagnosisOptions.find((o) => o.id === scenario.correctDiagnosisId)?.label}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{scenario.rootCause}</p>
              </div>
            </div>
          ) : (
            <>
              <ul className="space-y-1.5" role="radiogroup" aria-label="Diagnosis options">
                {scenario.diagnosisOptions.map((option) => {
                  const alreadyTried = investigation.diagnosisAttempts.includes(option.id);
                  const isSelected = selectedDiagnosis === option.id;

                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={alreadyTried}
                        onClick={() => {
                          setSelectedDiagnosis(option.id);
                          setFeedback(null);
                        }}
                        className={cx(
                          "flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                          alreadyTried
                            ? "cursor-not-allowed border-line bg-surface/50 opacity-50"
                            : isSelected
                              ? "border-accent/50 bg-accent/10"
                              : "border-line bg-surface-3/50 hover:border-line hover:bg-surface-3",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                            isSelected ? "border-accent" : "border-ink-4",
                          )}
                        >
                          {isSelected ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">
                          {option.label}
                        </span>
                        {alreadyTried ? (
                          <XCircle size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {feedback && !feedback.correct ? (
                <div className="anim-fade-up mt-3 flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn/8 px-3 py-2.5">
                  <AlertTriangle size={14} className="mt-px shrink-0 text-warn" aria-hidden="true" />
                  <div>
                    <p className="text-[12px] font-medium text-warn">Ruled out</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{feedback.text}</p>
                  </div>
                </div>
              ) : null}

              <Button
                variant="primary"
                className="mt-3 w-full"
                disabled={!selectedDiagnosis}
                onClick={submit}
              >
                Submit diagnosis
              </Button>
            </>
          )}
        </div>
      </Panel>

      {/* Remediation */}
      <Panel>
        <PanelHeader
          title="Remediation"
          subtitle={
            recovering
              ? "Recovery in progress — metrics are returning to baseline"
              : solved
                ? "Choose the action that addresses the root cause"
                : "Available now, but diagnosing first scores higher"
          }
          meta={
            investigation.remainingSteps.length > 0 && solved
              ? `${investigation.remainingSteps.length} step${investigation.remainingSteps.length === 1 ? "" : "s"} remaining`
              : undefined
          }
        />

        <div className="p-4">
          {pendingAction ? (
            <div className="flex items-center gap-2.5 rounded-md border border-accent/30 bg-accent/8 px-3 py-3">
              <Loader2 size={15} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">
                  {scenario.remediationOptions.find((o) => o.id === pendingAction.id)?.label}
                </p>
                <p className="text-[11.5px] text-ink-3">
                  In progress — {formatDuration(pendingAction.remainingSeconds)} remaining
                </p>
              </div>
            </div>
          ) : recovering ? (
            <div className="flex items-start gap-2.5 rounded-md border border-ok/30 bg-ok/8 px-3 py-2.5">
              <CheckCircle2 size={15} className="mt-px shrink-0 text-ok" aria-hidden="true" />
              <div>
                <p className="text-[12.5px] font-medium text-ok">Remediation applied</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
                  {scenario.resolution}
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {scenario.remediationOptions.map((option) => {
                const applied = investigation.actionsTaken.includes(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      disabled={applied}
                      onClick={() => remediate(option.id)}
                      className={cx(
                        "flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                        applied
                          ? "cursor-not-allowed border-line bg-surface/50 opacity-50"
                          : "border-line bg-surface-3/50 hover:border-accent/40 hover:bg-surface-3",
                      )}
                    >
                      <Wrench size={13} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium text-ink">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-4">
                          {option.description}
                        </span>
                      </span>
                      <span className="tabnum shrink-0 font-mono text-[10.5px] text-ink-4">
                        {option.durationSeconds}s
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>

      {/* What ineffective actions taught us */}
      {investigation.actionsTaken.filter((id) => !scenario.requiredRemediationIds.includes(id))
        .length > 0 ? (
        <Panel>
          <PanelHeader title="Actions that did not help" />
          <ul className="divide-y divide-line">
            {investigation.actionsTaken
              .filter((id) => !scenario.requiredRemediationIds.includes(id))
              .map((id) => {
                const option = scenario.remediationOptions.find((o) => o.id === id);
                if (!option) return null;
                return (
                  <li key={id} className="px-4 py-2.5">
                    <p className="text-[12px] font-medium text-ink-2">{option.label}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-4">
                      {option.ineffectiveNote}
                    </p>
                  </li>
                );
              })}
          </ul>
        </Panel>
      ) : null}

      <SectionLabel className="text-center">
        Evidence viewed: {investigation.evidenceViewed.length} · Actions taken:{" "}
        {investigation.actionsTaken.length}
        {investigation.hintsRevealed > 0 ? ` · Hints: ${investigation.hintsRevealed}` : ""}
      </SectionLabel>
    </div>
  );
}

/**
 * Guided mode.
 *
 * Off by default, because handing an experienced visitor the answer ruins the
 * exercise. When on, hints reveal one at a time and never name the diagnosis —
 * the first says where to look, the second what is notable there, and the third
 * describes the mechanism. The final judgement always stays with the operator.
 *
 * Hints cost 4 points each, deliberately less than a wrong guess costs, so
 * asking for help is always better than flailing.
 */
function GuidancePanel({
  scenario,
  hintsRevealed,
  guidedMode,
  onToggleGuided,
  onTakeHint,
  solved,
}: {
  scenario: ReturnType<typeof getScenario>;
  hintsRevealed: number;
  guidedMode: boolean;
  onToggleGuided: () => void;
  onTakeHint: () => void;
  solved: boolean;
}) {
  const total = scenario.hints.length;
  const remaining = total - hintsRevealed;

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <Compass size={13} className="text-accent" aria-hidden="true" />
            Guided mode
          </span>
        }
        subtitle={
          guidedMode
            ? "Hints reveal one at a time and never name the answer."
            : "New to this? Turn on step-by-step guidance."
        }
        actions={
          <button
            type="button"
            role="switch"
            aria-checked={guidedMode}
            onClick={onToggleGuided}
            className={cx(
              "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
              guidedMode ? "border-accent/50 bg-accent/30" : "border-line bg-surface-3",
            )}
          >
            <span className="sr-only">
              {guidedMode ? "Turn off guided mode" : "Turn on guided mode"}
            </span>
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
                guidedMode ? "left-[18px] bg-accent" : "left-0.5 bg-ink-4",
              )}
            />
          </button>
        }
      />

      {guidedMode ? (
        <div className="p-4">
          {hintsRevealed === 0 ? (
            <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">
              Work the evidence first. If you get stuck, take a hint — each one costs 4 points,
              which is less than a wrong diagnosis.
            </p>
          ) : null}

          <ol className="space-y-2">
            {scenario.hints.slice(0, hintsRevealed).map((hint, index) => (
              <li
                key={hint.title}
                className="anim-fade-up rounded-md border border-accent/25 bg-accent/8 px-3 py-2.5"
              >
                <p className="flex items-baseline gap-2 text-[12.5px] font-medium text-ink">
                  <span className="tabnum font-mono text-[10px] text-accent">
                    {index + 1}/{total}
                  </span>
                  {hint.title}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{hint.body}</p>
              </li>
            ))}
          </ol>

          {solved ? (
            <p className="mt-3 text-[12px] text-ink-4">
              Root cause identified — no further hints needed.
            </p>
          ) : remaining > 0 ? (
            <Button
              variant="secondary"
              className={cx("w-full", hintsRevealed > 0 && "mt-3")}
              icon={<Lightbulb size={13} />}
              onClick={onTakeHint}
            >
              {hintsRevealed === 0 ? "Give me a hint" : `Next hint (${remaining} left)`} · −4 pts
            </Button>
          ) : (
            <p className="mt-3 text-[12px] text-ink-4">
              That is every hint. The rest is yours to work out — check the evidence links above.
            </p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
