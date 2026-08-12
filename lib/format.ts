import type { HealthStatus } from "@/lib/sim/types";

/**
 * Formatting helpers.
 *
 * All timestamps render in UTC. The simulation has a single global clock and an
 * operations centre works in one timezone by convention — formatting in the
 * viewer's local time would make log lines, alerts and the timeline disagree
 * with each other.
 */

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

/** 14:03:51 */
export function formatTime(timestamp: number): string {
  return TIME_FORMAT.format(new Date(timestamp));
}

/** 14:03:51.432 — used in the log explorer where sub-second order matters. */
export function formatTimePrecise(timestamp: number): string {
  const ms = String(Math.floor(timestamp % 1000)).padStart(3, "0");
  return `${TIME_FORMAT.format(new Date(timestamp))}.${ms}`;
}

/** 2026-08-11 14:03:51 */
export function formatDateTime(timestamp: number): string {
  return `${DATE_FORMAT.format(new Date(timestamp))} ${TIME_FORMAT.format(new Date(timestamp))}`;
}

/** "4m 12s ago" — relative to the simulated clock, never the wall clock. */
export function formatRelative(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "4m 12s" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Latency with a unit that suits its magnitude. */
export function formatLatency(ms: number): string {
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${Math.round(ms)}ms`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

/** Compact throughput: 1.4k, 12.8k */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  if (value >= 100) return Math.round(value).toString();
  return value.toFixed(value < 10 ? 1 : 0);
}

export function formatPercent(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Availability needs more precision than an ordinary percentage. */
export function formatAvailability(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 99.99) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(2)}%`;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Status vocabulary
//
// Status is never communicated by colour alone: every helper here pairs a
// colour with a word and a glyph so the interface stays readable for colour-
// blind users and in forced-colours mode.
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  offline: "Offline",
};

/** A distinct shape per status, so the states differ by more than hue. */
export const STATUS_GLYPH: Record<HealthStatus, string> = {
  healthy: "●",
  degraded: "▲",
  critical: "■",
  offline: "✕",
};

export const STATUS_TEXT_CLASS: Record<HealthStatus, string> = {
  healthy: "text-ok",
  degraded: "text-warn",
  critical: "text-crit",
  offline: "text-idle",
};

export const STATUS_BG_CLASS: Record<HealthStatus, string> = {
  healthy: "bg-ok",
  degraded: "bg-warn",
  critical: "bg-crit",
  offline: "bg-idle",
};

export const STATUS_BORDER_CLASS: Record<HealthStatus, string> = {
  healthy: "border-ok/30",
  degraded: "border-warn/30",
  critical: "border-crit/30",
  offline: "border-idle/30",
};

export const STATUS_SURFACE_CLASS: Record<HealthStatus, string> = {
  healthy: "bg-ok-dim",
  degraded: "bg-warn-dim",
  critical: "bg-crit-dim",
  offline: "bg-idle-dim",
};

/** Chart stroke colour for a status, as a CSS variable reference. */
export const STATUS_VAR: Record<HealthStatus, string> = {
  healthy: "var(--color-ok)",
  degraded: "var(--color-warn)",
  critical: "var(--color-crit)",
  offline: "var(--color-idle)",
};

export function severityTextClass(severity: "critical" | "warning" | "info"): string {
  return severity === "critical" ? "text-crit" : severity === "warning" ? "text-warn" : "text-info";
}

/** Join class names, dropping falsy values. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
