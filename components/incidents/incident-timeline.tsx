"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Flag,
  Radar,
  StickyNote,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { cx, formatTime } from "@/lib/format";
import type { TimelineEvent } from "@/lib/sim/types";

/**
 * Incident timeline.
 *
 * A single vertical rail with typed events. Entries are appended as the incident
 * unfolds, so the newest work is at the bottom — reading top to bottom replays
 * the incident in the order it happened, which is what a post-mortem needs.
 */

const KIND_META: Record<
  TimelineEvent["kind"],
  { icon: typeof AlertTriangle; tone: string; label: string }
> = {
  detection: { icon: Radar, tone: "text-info border-info/30 bg-info/10", label: "Detection" },
  alert: { icon: AlertTriangle, tone: "text-warn border-warn/30 bg-warn/10", label: "Alert" },
  declaration: { icon: Flag, tone: "text-crit border-crit/30 bg-crit/10", label: "Declared" },
  investigation: {
    icon: FileSearch,
    tone: "text-ink-2 border-line bg-surface-3",
    label: "Investigation",
  },
  diagnosis: { icon: FileSearch, tone: "text-accent border-accent/30 bg-accent/10", label: "Diagnosis" },
  remediation: { icon: Wrench, tone: "text-accent border-accent/30 bg-accent/10", label: "Remediation" },
  recovery: { icon: TrendingUp, tone: "text-ok border-ok/30 bg-ok/10", label: "Recovery" },
  resolution: { icon: CheckCircle2, tone: "text-ok border-ok/30 bg-ok/10", label: "Resolved" },
  note: { icon: StickyNote, tone: "text-ink-3 border-line bg-surface-3", label: "Note" },
};

export function IncidentTimeline({
  events,
  startedAt,
  className,
  dense = false,
}: {
  events: TimelineEvent[];
  startedAt: number;
  className?: string;
  dense?: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className={cx("px-4 py-6 text-center text-[12px] text-ink-4", className)}>
        No timeline events yet.
      </p>
    );
  }

  return (
    <ol className={cx("relative", className)}>
      {/* The rail */}
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-[26px] top-3 w-px bg-line"
      />

      {events.map((event, index) => {
        const meta = KIND_META[event.kind];
        const Icon = meta.icon;
        const offsetSeconds = Math.max(0, Math.round((event.timestamp - startedAt) / 1000));
        const isLast = index === events.length - 1;

        return (
          <li
            key={event.id}
            className={cx(
              "relative flex gap-3 px-4",
              dense ? "py-1.5" : "py-2",
              // Only the newest entry animates in, so the list does not
              // re-animate wholesale on every tick.
              isLast && "anim-fade-up",
            )}
          >
            <span
              className={cx(
                "relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                meta.tone,
              )}
            >
              <Icon size={10} aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1 pb-0.5">
              <p className="text-[12.5px] leading-snug text-ink-2">{event.message}</p>
              <p className="tabnum mt-0.5 font-mono text-[10px] text-ink-4">
                {formatTime(event.timestamp)}
                <span className="mx-1.5 text-ink-4">·</span>
                T+{formatOffset(offsetSeconds)}
                {event.actor ? (
                  <>
                    <span className="mx-1.5 text-ink-4">·</span>
                    {event.actor}
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Offsets read as 4:12 rather than 252s, matching how incidents are discussed. */
function formatOffset(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
