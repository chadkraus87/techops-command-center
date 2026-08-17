"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { cx, formatLatency, formatPercent, formatTime } from "@/lib/format";
import { replayDuration, replayIncidentAt } from "@/lib/sim/engine";
import { summariseFleet } from "@/lib/sim/metrics";
import { TopologyMap } from "@/components/topology/topology-map";
import { Button, Panel, PanelHeader, SectionLabel } from "@/components/ui/primitives";
import type { Incident } from "@/lib/sim/types";

/**
 * Incident replay.
 *
 * Scrub back through an incident and watch the cascade unfold. No frames were
 * recorded while it happened — every position is reconstructed on demand from
 * the scenario plus two numbers stored on the incident, because the engine is a
 * pure function of (tick, clock, elapsed).
 *
 * That is what makes this cheap enough to exist at all: a naive implementation
 * would have had to record and store thousands of frames per run.
 */

/** Playback runs faster than real time — nobody wants to watch 3 minutes. */
const PLAYBACK_SPEED = 8;
const FRAME_MS = 100;

export function IncidentReplay({ incident }: { incident: Incident }) {
  const duration = useMemo(() => replayDuration(incident), [incident]);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Reconstructing is cheap, but not free — only redo it when the position moves.
  const frame = useMemo(() => replayIncidentAt(incident, elapsed), [incident, elapsed]);
  const fleet = useMemo(() => summariseFleet(frame.services), [frame.services]);

  // Keep the newest visible event in view as playback advances.
  const eventsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const node = eventsRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [frame.events.length]);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + (PLAYBACK_SPEED * FRAME_MS) / 1000;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, FRAME_MS);
    return () => window.clearInterval(interval);
  }, [playing, duration]);

  const atEnd = elapsed >= duration;

  return (
    <Panel>
      <PanelHeader
        title="Replay"
        subtitle="Scrub back through the incident and watch the failure spread"
        meta={`T+${formatOffset(elapsed)}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setElapsed(0)}
              aria-label="Back to start"
            >
              <SkipBack size={13} />
            </Button>
            <Button
              variant={playing ? "secondary" : "primary"}
              size="sm"
              onClick={() => {
                // Replaying from the end should restart rather than do nothing.
                if (atEnd) setElapsed(0);
                setPlaying((p) => !p);
              }}
              icon={playing ? <Pause size={13} /> : <Play size={13} />}
            >
              {playing ? "Pause" : atEnd ? "Replay" : "Play"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setElapsed(duration)}
              aria-label="Jump to end"
            >
              <SkipForward size={13} />
            </Button>
          </div>
        }
      />

      {/* Scrubber */}
      <div className="border-b border-line px-4 py-3">
        <label htmlFor={`replay-${incident.id}`} className="sr-only">
          Replay position, in seconds since the incident began
        </label>
        <input
          id={`replay-${incident.id}`}
          type="range"
          min={0}
          max={duration}
          step={1}
          value={Math.round(elapsed)}
          onChange={(event) => {
            setPlaying(false);
            setElapsed(Number(event.target.value));
          }}
          className="w-full accent-[var(--color-accent)]"
        />
        <div className="tabnum mt-1 flex justify-between font-mono text-[10px] text-ink-4">
          <span>T+0:00</span>
          <span>{formatTime(frame.clock)} UTC</span>
          <span>T+{formatOffset(duration)}</span>
        </div>
      </div>

      {/* Reconstructed fleet at this instant */}
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {[
          {
            label: "Status",
            value:
              fleet.status === "operational"
                ? "Operational"
                : fleet.status === "degraded"
                  ? "Degraded"
                  : "Major incident",
            tone:
              fleet.status === "operational"
                ? "text-ok"
                : fleet.status === "degraded"
                  ? "text-warn"
                  : "text-crit",
          },
          {
            label: "Unhealthy",
            value: `${fleet.degradedCount + fleet.criticalCount}/${fleet.servicesTotal}`,
            tone: fleet.criticalCount > 0 ? "text-crit" : undefined,
          },
          { label: "Error rate", value: formatPercent(fleet.errorRate, 1) },
          { label: "Avg latency", value: formatLatency(fleet.avgLatency) },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-2 px-4 py-2.5">
            <p className="text-[10.5px] text-ink-4">{stat.label}</p>
            <p
              className={cx(
                "tabnum mt-0.5 font-mono text-[14px] font-medium",
                stat.tone ?? "text-ink",
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <SectionLabel className="mb-2 block">Topology at this moment</SectionLabel>
          <TopologyMap compact services={frame.services} className="h-[300px] min-w-[520px]" />
        </div>

        <div className="min-w-0">
          <SectionLabel className="mb-2 block">Timeline so far</SectionLabel>
          <ol
            ref={eventsRef}
            className="h-[300px] space-y-1.5 overflow-y-auto rounded-md border border-line bg-void/40 p-2"
          >
            {frame.events.length === 0 ? (
              <li className="px-1 py-2 text-[11.5px] text-ink-4">Nothing has happened yet.</li>
            ) : (
              frame.events.map((event) => (
                <li key={event.id} className="rounded bg-surface-2/60 px-2 py-1.5">
                  <p className="text-[11.5px] leading-snug text-ink-2">{event.message}</p>
                  <p className="tabnum mt-0.5 font-mono text-[9.5px] text-ink-4">
                    {formatTime(event.timestamp)}
                    {event.actor ? ` · ${event.actor}` : ""}
                  </p>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>

      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-4">
        Every frame here is recomputed from the scenario rather than recorded — the simulation is
        deterministic, so any moment can be rebuilt exactly.
      </p>
    </Panel>
  );
}

/** T+4:12 reads better than 252s when discussing an incident. */
function formatOffset(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
