"use client";

import { useRouter } from "next/navigation";
import { Activity, Search, Wrench, Zap } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlay";

/**
 * First-visit introduction.
 *
 * Deliberately one screen with two exits. A visitor who wants to explore should
 * be one click from the dashboard, and a visitor who wants the interesting part
 * should be one click from an incident. Anything longer than this gets skipped
 * anyway, and the choice is remembered locally so it never appears twice.
 */

const STEPS = [
  {
    icon: Activity,
    title: "Monitor",
    body: "Fifteen services with live metrics, logs, alerts and a dependency map — all healthy to begin with.",
  },
  {
    icon: Zap,
    title: "Break something",
    body: "Trigger one of eight incident scenarios. Metrics, logs, tickets and topology all react together.",
  },
  {
    icon: Search,
    title: "Investigate",
    body: "Read the evidence, run network diagnostics, then commit to a root-cause diagnosis.",
  },
  {
    icon: Wrench,
    title: "Fix it",
    body: "Choose a remediation. Only the correct action recovers the system — and you're scored on the whole run.",
  },
];

export function Onboarding({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter();

  return (
    <Modal
      open
      onClose={onDismiss}
      title="Welcome to TechOps Command Center"
      description="An interactive incident-response simulator. No account, nothing to install — the environment is running already."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onDismiss}>
            Explore the dashboard
          </Button>
          <Button
            variant="primary"
            icon={<Zap size={14} />}
            onClick={() => {
              onDismiss();
              router.push("/simulation");
            }}
          >
            Start an incident
          </Button>
        </>
      }
    >
      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className="panel-flush flex gap-3 p-3.5"
              style={{ animation: `fade-up 0.35s var(--ease-out-quart) ${index * 60}ms both` }}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-3 text-accent">
                <Icon size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold tracking-tight text-ink">
                  <span className="tabnum mr-1.5 font-mono text-[11px] text-ink-4">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {step.title}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-4">
        Tip: press <kbd className="rounded border border-line bg-surface-3 px-1 font-mono">⌘K</kbd>{" "}
        anywhere to search, or <kbd className="rounded border border-line bg-surface-3 px-1 font-mono">g</kbd>{" "}
        then a letter to jump between sections.
      </p>
    </Modal>
  );
}
