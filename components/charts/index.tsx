"use client";

import { useId, useMemo, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx, formatTime } from "@/lib/format";
import type { SeriesPoint } from "@/lib/sim/history";

/**
 * Charts.
 *
 * House rules, applied consistently:
 *  - Grid is horizontal only and barely visible; axis lines are removed. The
 *    data is the brightest thing in the frame.
 *  - Marks are thin (2px) and never dotted per-point.
 *  - Every time-series ships with a crosshair and tooltip — an SVG chart in a
 *    browser is an interactive medium, so a static one is a wasted affordance.
 *  - Update animation is OFF. These charts re-render every second; animating
 *    each new sample makes a live dashboard look broken rather than alive.
 *  - Tooltip text uses ink tokens; the series colour appears only as a mark.
 */

const AXIS_TICK = { fill: "var(--color-ink-4)", fontSize: 10 };
const GRID_STROKE = "var(--color-line-soft)";

export type ChartTone = "accent" | "ok" | "warn" | "crit" | "info" | "series-1" | "series-2";

const TONE_VAR: Record<ChartTone, string> = {
  accent: "var(--color-accent)",
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  crit: "var(--color-crit)",
  info: "var(--color-info)",
  "series-1": "var(--color-series-1)",
  "series-2": "var(--color-series-2)",
};

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadItem {
  value?: number;
  name?: string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: number | string;
  formatter: (value: number) => string;
  labelFormatter?: (label: number | string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="pointer-events-none rounded-md border border-line bg-surface-4/95 px-2.5 py-1.5 shadow-xl backdrop-blur-sm">
      <p className="tabnum mb-1 font-mono text-[10px] text-ink-4">
        {labelFormatter && label !== undefined
          ? labelFormatter(label)
          : typeof label === "number"
            ? formatTime(label)
            : label}
      </p>
      {payload.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-[3px] w-3 shrink-0 rounded-full"
            style={{ background: item.color }}
          />
          {payload.length > 1 && item.name ? (
            <span className="text-[11px] text-ink-3">{item.name}</span>
          ) : null}
          <span className="tabnum ml-auto font-mono text-[12px] font-medium text-ink">
            {formatter(item.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area time series — the workhorse
// ---------------------------------------------------------------------------

interface TimeSeriesProps {
  data: SeriesPoint[];
  tone?: ChartTone;
  height?: number;
  formatter: (value: number) => string;
  /** Draw a dashed reference line, e.g. an SLO threshold. */
  threshold?: { value: number; label?: string };
  showAxis?: boolean;
  /** Force the y-axis to start at zero — correct for counts and rates. */
  zeroBased?: boolean;
  className?: string;
}

export function TimeSeriesChart({
  data,
  tone = "accent",
  height = 160,
  formatter,
  threshold,
  showAxis = true,
  zeroBased = true,
  className,
}: TimeSeriesProps) {
  const gradientId = useId().replace(/:/g, "");
  const color = TONE_VAR[tone];

  // A little headroom above the peak keeps the trace off the top edge.
  const domain = useMemo<[number | "auto", number | "auto"]>(() => {
    const values = data.map((d) => d.v).filter((v) => Number.isFinite(v));
    if (values.length === 0) return [0, "auto"];
    const max = Math.max(...values, threshold?.value ?? 0);
    const min = Math.min(...values);
    return [zeroBased ? 0 : min * 0.92, max * 1.15 || 1];
  }, [data, threshold, zeroBased]);

  return (
    <div className={cx("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: showAxis ? 0 : -34 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="0" vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => formatTime(value)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={44}
            hide={!showAxis}
          />
          <YAxis
            domain={domain}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={46}
            tickFormatter={(value: number) => formatter(value)}
            hide={!showAxis}
          />

          {threshold ? (
            <ReferenceLine
              y={threshold.value}
              stroke="var(--color-ink-4)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={
                threshold.label
                  ? {
                      value: threshold.label,
                      position: "insideTopRight",
                      fill: "var(--color-ink-4)",
                      fontSize: 9,
                    }
                  : undefined
              }
            />
          ) : null}

          <Tooltip
            content={<ChartTooltip formatter={formatter} />}
            cursor={{ stroke: "var(--color-ink-4)", strokeWidth: 1, strokeDasharray: "3 3" }}
            wrapperStyle={{ outline: "none" }}
            isAnimationActive={false}
          />

          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--color-surface)" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-series line — percentiles, which are ordered, so a single-hue ramp
// carries the magnitude rather than unrelated categorical colours.
// ---------------------------------------------------------------------------

export interface MultiSeries {
  key: string;
  name: string;
  color: string;
  data: SeriesPoint[];
}

export function MultiLineChart({
  series,
  height = 180,
  formatter,
  className,
}: {
  series: MultiSeries[];
  height?: number;
  formatter: (value: number) => string;
  className?: string;
}) {
  // Recharts wants one row per x value with a column per series.
  const merged = useMemo(() => {
    const base = series[0]?.data ?? [];
    return base.map((point, index) => {
      const row: Record<string, number> = { t: point.t };
      for (const s of series) row[s.key] = s.data[index]?.v ?? 0;
      return row;
    });
  }, [series]);

  return (
    <div className={cx("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => formatTime(value)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={44}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => formatter(value)}
          />
          <Tooltip
            content={<ChartTooltip formatter={formatter} />}
            cursor={{ stroke: "var(--color-ink-4)", strokeWidth: 1, strokeDasharray: "3 3" }}
            wrapperStyle={{ outline: "none" }}
            isAnimationActive={false}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--color-surface)" }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend for a multi-series chart. Identity is never colour-alone. */
export function ChartLegend({ series }: { series: Array<{ name: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-[3px] w-3.5 rounded-full"
            style={{ background: s.color }}
          />
          <span className="text-[11px] text-ink-3">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — hand-rolled SVG. At 40×16 a charting library is all overhead,
// and a raw path gives crisper control of the end cap.
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  tone = "accent",
  width = 72,
  height = 22,
  className,
}: {
  values: number[];
  tone?: ChartTone;
  width?: number;
  height?: number;
  className?: string;
}) {
  const color = TONE_VAR[tone];
  const gradientId = useId().replace(/:/g, "");

  const { path, areaPath, lastPoint } = useMemo(() => {
    if (values.length < 2) return { path: "", areaPath: "", lastPoint: null };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    // Inset vertically so the stroke is never clipped at the extremes.
    const inset = 2;

    const points = values.map((value, index) => {
      const x = index * stepX;
      const y = height - inset - ((value - min) / span) * (height - inset * 2);
      return [x, y] as const;
    });

    const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${d} L${width},${height} L0,${height} Z`;

    return { path: d, areaPath: area, lastPoint: points[points.length - 1] };
  }, [values, width, height]);

  if (!path) {
    return <div className={cx("shrink-0", className)} style={{ width, height }} aria-hidden="true" />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("shrink-0 overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastPoint ? (
        <circle
          cx={lastPoint[0]}
          cy={lastPoint[1]}
          r={2}
          fill={color}
          stroke="var(--color-surface)"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stat tile — a hero number is a chart form in its own right
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  sparkline,
  tone = "accent",
  delta,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sparkline?: number[];
  tone?: ChartTone;
  /** Fractional change; sign decides the arrow, `tone` decides the colour. */
  delta?: number;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col justify-between gap-2 p-3.5 sm:p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium tracking-tight text-ink-3">{label}</span>
        {sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} tone={tone} width={54} height={18} />
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="tabnum font-mono text-[22px] font-semibold leading-none tracking-tight text-ink sm:text-[26px]">
          {value}
        </span>
        {unit ? <span className="text-[12px] font-medium text-ink-3">{unit}</span> : null}
        {delta !== undefined && Math.abs(delta) > 0.01 ? (
          <span
            className={cx(
              "tabnum ml-auto font-mono text-[11px]",
              tone === "crit" || tone === "warn" ? "text-warn" : "text-ink-3",
            )}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-[11px] leading-tight text-ink-4">{hint}</div> : null}
    </div>
  );
}
