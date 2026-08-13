"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { cx, formatTime, STATUS_TEXT_CLASS } from "@/lib/format";
import { pageTitleFor } from "@/lib/nav";
import { summariseFleet } from "@/lib/sim/metrics";
import { useSimStore } from "@/lib/store/sim-store";
import { Beacon, Button, ToggleGroup, Tooltip } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import type { SimSpeed } from "@/lib/sim/types";

/**
 * Top bar.
 *
 * Holds the two things that must be visible from every screen: the global
 * system status, and control of the clock. Because the whole product is time
 * based, being able to pause and re-read a moment is a genuine usability
 * feature rather than a gimmick.
 */

/**
 * Two labels per state: the full phrase where there is room, and a short form
 * for narrow screens. Truncating the long one to "All S…" tells the operator
 * nothing, which defeats the point of a always-visible status indicator.
 */
const STATUS_COPY = {
  operational: {
    label: "All Systems Operational",
    short: "Operational",
    status: "healthy" as const,
  },
  degraded: { label: "Degraded Performance", short: "Degraded", status: "degraded" as const },
  "major-incident": { label: "Major Incident", short: "Incident", status: "critical" as const },
};

export function Topbar({
  onOpenMobileNav,
  soundEnabled,
  onToggleSound,
}: {
  onOpenMobileNav: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const pathname = usePathname();
  const [confirmReset, setConfirmReset] = useState(false);

  const clock = useSimStore((s) => s.state.clock);
  const running = useSimStore((s) => s.state.running);
  const speed = useSimStore((s) => s.state.speed);
  const services = useSimStore((s) => s.state.services);
  const activePhase = useSimStore((s) => s.state.active?.phase ?? null);
  // A resolved scenario is still "active" until its report is dismissed, but it
  // is no longer an emergency — the control must not keep shouting.
  const incidentInProgress = activePhase !== null && activePhase !== "resolved";
  const reportPending = activePhase === "resolved";
  const togglePause = useSimStore((s) => s.togglePause);
  const setSpeed = useSimStore((s) => s.setSpeed);
  const reset = useSimStore((s) => s.reset);

  const fleet = summariseFleet(services);
  const copy = STATUS_COPY[fleet.status];
  const pageTitle = pageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-2/85 px-3 backdrop-blur-md sm:px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={17} />
      </button>

      {/* Page identity + global status */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="hidden shrink-0 text-[13px] font-semibold tracking-tight text-ink sm:block">
          {pageTitle}
        </h1>

        <div
          className={cx(
            "flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1",
            fleet.status === "operational" && "border-ok/20 bg-ok/8",
            fleet.status === "degraded" && "border-warn/20 bg-warn/8",
            fleet.status === "major-incident" && "border-crit/25 bg-crit/10",
          )}
        >
          <Beacon status={copy.status} />
          <span className={cx("text-[11.5px] font-medium", STATUS_TEXT_CLASS[copy.status])}>
            <span className="sm:hidden">{copy.short}</span>
            <span className="hidden sm:inline">{copy.label}</span>
          </span>
        </div>
      </div>

      {/* Operations clock */}
      <div className="hidden items-center gap-2 border-l border-line pl-3 sm:flex">
        <div className="text-right">
          <p className="tabnum font-mono text-[13px] font-medium leading-none text-ink">
            {formatTime(clock)}
          </p>
          <p className="text-[9px] leading-tight text-ink-4">UTC · simulated</p>
        </div>
      </div>

      {/* Clock controls */}
      <div className="flex shrink-0 items-center gap-1.5 border-l border-line pl-3">
        <Tooltip label={running ? "Pause simulation" : "Resume simulation"}>
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePause}
            aria-label={running ? "Pause simulation" : "Resume simulation"}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
          </Button>
        </Tooltip>

        <ToggleGroup
          className="hidden md:inline-flex"
          label="Simulation speed"
          value={speed}
          onChange={(value) => setSpeed(value as SimSpeed)}
          options={[
            { value: 1, label: "1×", title: "Real time" },
            { value: 2, label: "2×", title: "Double speed" },
            { value: 4, label: "4×", title: "Quadruple speed" },
          ]}
        />

        <Tooltip label={soundEnabled ? "Mute alert sounds" : "Enable alert sounds"}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSound}
            aria-label={soundEnabled ? "Mute alert sounds" : "Enable alert sounds"}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </Button>
        </Tooltip>

        <Tooltip label="Reset environment">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmReset(true)}
            aria-label="Reset environment"
          >
            <RotateCcw size={14} />
          </Button>
        </Tooltip>

        {incidentInProgress ? (
          <Link
            href="/simulation"
            className="ml-1 hidden items-center gap-1.5 rounded-md border border-crit/30 bg-crit/10 px-3 py-1.5 text-[12px] font-medium text-crit transition-colors hover:bg-crit/18 sm:inline-flex"
          >
            <span className="beacon beacon-pulse bg-crit" aria-hidden="true" />
            Incident Active
          </Link>
        ) : reportPending ? (
          <Link
            href="/simulation"
            className="ml-1 hidden items-center gap-1.5 rounded-md border border-ok/30 bg-ok/10 px-3 py-1.5 text-[12px] font-medium text-ok transition-colors hover:bg-ok/18 sm:inline-flex"
          >
            <span className="beacon bg-ok" aria-hidden="true" />
            View Report
          </Link>
        ) : (
          <Link
            href="/simulation"
            className="ml-1 hidden items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_2px_8px_-2px_rgba(91,140,255,0.5)] transition-colors hover:bg-[#6d99ff] sm:inline-flex"
          >
            <Zap size={13} />
            Start Incident
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={reset}
        title="Reset environment?"
        description="Restores healthy services, baseline metrics, normal logs and an empty incident queue. Your saved scores are kept."
        confirmLabel="Reset environment"
        destructive
      />
    </header>
  );
}
