import { baselineMetrics, derivePercentiles } from "./metrics";
import { getService } from "./services";
import type { MetricKey, ServiceId, SimState } from "./types";

/**
 * Chart history.
 *
 * The store keeps four minutes of live samples at one-second resolution. Longer
 * ranges are *computed* from the same deterministic baseline model rather than
 * stored, which keeps memory flat and is honest: the model that produced the
 * last four minutes is the model that describes the preceding day. An incident
 * appears as a spike at the right-hand edge of a long quiet trace, exactly as it
 * would on a real dashboard.
 */

export type TimeRange = "15m" | "1h" | "6h" | "24h";

export const TIME_RANGES: Array<{ value: TimeRange; label: string; seconds: number }> = [
  { value: "15m", label: "15m", seconds: 15 * 60 },
  { value: "1h", label: "1h", seconds: 60 * 60 },
  { value: "6h", label: "6h", seconds: 6 * 60 * 60 },
  { value: "24h", label: "24h", seconds: 24 * 60 * 60 },
];

export interface SeriesPoint {
  /** Simulated timestamp for this sample. */
  t: number;
  /** The value, or null where the series has no reading. */
  v: number;
}

const POINTS_PER_CHART = 120;

export function rangeSeconds(range: TimeRange): number {
  return TIME_RANGES.find((r) => r.value === range)?.seconds ?? 900;
}

/**
 * Build a chart series for one service metric over the requested range.
 *
 * Live samples always win at the right-hand edge; anything older than the live
 * buffer is synthesised from the baseline model.
 */
export function buildSeries(
  state: SimState,
  serviceId: ServiceId,
  metric: MetricKey,
  range: TimeRange,
): SeriesPoint[] {
  const totalSeconds = rangeSeconds(range);
  const step = Math.max(1, Math.round(totalSeconds / POINTS_PER_CHART));
  const live = state.history[`${serviceId}:${metric}`] ?? [];
  const def = getService(serviceId);
  const points: SeriesPoint[] = [];

  for (let i = POINTS_PER_CHART - 1; i >= 0; i--) {
    const secondsAgo = i * step;
    const timestamp = state.clock - secondsAgo * 1000;

    // Inside the live buffer? Use the real recorded sample.
    if (secondsAgo < live.length) {
      const index = live.length - 1 - secondsAgo;
      points.push({ t: timestamp, v: live[index] });
      continue;
    }

    // Otherwise recreate what the healthy baseline would have read.
    const pastTick = state.tickCount - secondsAgo;
    const snapshot = derivePercentiles(baselineMetrics(def, pastTick, timestamp), def);
    points.push({ t: timestamp, v: snapshot[metric] ?? 0 });
  }

  return points;
}

/** Fleet-level series for the overview charts. */
export function buildGlobalSeries(
  state: SimState,
  key: "rps" | "latency" | "errorRate" | "tickets",
  range: TimeRange,
): SeriesPoint[] {
  const totalSeconds = rangeSeconds(range);
  const step = Math.max(1, Math.round(totalSeconds / POINTS_PER_CHART));
  const live = state.globalHistory[key] ?? [];
  const points: SeriesPoint[] = [];

  // The oldest live sample stands in for anything beyond the buffer, so a long
  // range shows a flat healthy baseline rather than a gap.
  const fallback = live.length > 0 ? live[0] : 0;

  for (let i = POINTS_PER_CHART - 1; i >= 0; i--) {
    const secondsAgo = i * step;
    const timestamp = state.clock - secondsAgo * 1000;
    if (secondsAgo < live.length) {
      points.push({ t: timestamp, v: live[live.length - 1 - secondsAgo] });
    } else {
      points.push({ t: timestamp, v: fallback });
    }
  }

  return points;
}

/** Just the live tail, for sparklines. Cheap — no synthesis. */
export function sparkSeries(
  state: SimState,
  serviceId: ServiceId,
  metric: MetricKey,
  count = 48,
): number[] {
  const live = state.history[`${serviceId}:${metric}`] ?? [];
  return live.slice(-count);
}

/** Percentage change between the start and end of a series. */
export function trendOf(values: number[]): number {
  if (values.length < 2) return 0;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return last === 0 ? 0 : 1;
  return (last - first) / Math.abs(first);
}
