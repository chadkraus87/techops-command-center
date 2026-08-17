"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cx, STATUS_BG_CLASS, STATUS_GLYPH, STATUS_LABEL, STATUS_TEXT_CLASS } from "@/lib/format";
import type { HealthStatus } from "@/lib/sim/types";

/**
 * The shared building blocks. Deliberately small and unopinionated — layout
 * composition happens in the feature components, so panels can vary in size,
 * density and emphasis instead of the whole product becoming a grid of
 * identical cards.
 */

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** `flush` drops the gradient for panels nested inside another panel. */
  variant?: "raised" | "flush";
}

export function Panel({ children, className, variant = "raised", ...rest }: PanelProps) {
  return (
    <div className={cx(variant === "raised" ? "panel" : "panel-flush", className)} {...rest}>
      {children}
    </div>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small text shown to the right of the title, e.g. a count. */
  meta?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, subtitle, actions, meta, className }: PanelHeaderProps) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-4 border-b border-line px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {meta ? <span className="tabnum text-[11px] text-ink-3">{meta}</span> : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section label — the small uppercase kicker used across the app
// ---------------------------------------------------------------------------

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status beacon and badge
// ---------------------------------------------------------------------------

export function Beacon({ status, className }: { status: HealthStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "beacon",
        STATUS_BG_CLASS[status],
        status !== "healthy" && "beacon-pulse",
        className,
      )}
    />
  );
}

interface StatusBadgeProps {
  status: HealthStatus;
  /** `dot` shows only the beacon plus a screen-reader label. */
  size?: "sm" | "md" | "dot";
  className?: string;
}

/**
 * Status is always colour + glyph + word. The glyph matters: it is what keeps
 * healthy and critical distinguishable without relying on red/green vision.
 */
export function StatusBadge({ status, size = "sm", className }: StatusBadgeProps) {
  if (size === "dot") {
    return (
      <span className={cx("inline-flex items-center", className)}>
        <Beacon status={status} />
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </span>
    );
  }

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
        size === "md" ? "text-[12px]" : "text-[11px]",
        STATUS_TEXT_CLASS[status],
        status === "healthy" && "border-ok/25 bg-ok/8",
        status === "degraded" && "border-warn/25 bg-warn/8",
        status === "critical" && "border-crit/25 bg-crit/8",
        status === "offline" && "border-idle/25 bg-idle/8",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[8px] leading-none">
        {STATUS_GLYPH[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Severity pill (incidents)
// ---------------------------------------------------------------------------

const SEVERITY_CLASS: Record<string, string> = {
  "SEV-1": "border-crit/40 bg-crit/12 text-crit",
  "SEV-2": "border-warn/40 bg-warn/12 text-warn",
  "SEV-3": "border-info/40 bg-info/12 text-info",
  "SEV-4": "border-idle/40 bg-idle/12 text-idle",
};

export function SeverityPill({ severity, className }: { severity: string; className?: string }) {
  return (
    <span
      className={cx(
        "tabnum inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide",
        SEVERITY_CLASS[severity] ?? SEVERITY_CLASS["SEV-4"],
        className,
      )}
    >
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "active:translate-y-px",
        size === "sm" && "h-7 px-2.5 text-[12px]",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-[14px]",
        variant === "primary" &&
          "bg-accent text-white shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_2px_8px_-2px_rgba(91,140,255,0.5)] hover:bg-[#6d99ff] disabled:hover:bg-accent",
        variant === "secondary" &&
          "border border-line bg-surface-3 text-ink hover:border-line hover:bg-surface-4",
        variant === "ghost" && "text-ink-2 hover:bg-surface-3 hover:text-ink",
        variant === "subtle" && "bg-surface-3/60 text-ink-2 hover:bg-surface-3 hover:text-ink",
        variant === "danger" &&
          "border border-crit/30 bg-crit/10 text-crit hover:border-crit/50 hover:bg-crit/18",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Toggle group — used for time ranges, severity filters, speed control
// ---------------------------------------------------------------------------

interface ToggleGroupProps<T extends string | number> {
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}

export function ToggleGroup<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  className,
}: ToggleGroupProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded font-medium transition-colors duration-150",
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]",
              selected
                ? "bg-surface-4 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-ink-3 hover:text-ink-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / error states
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-3 text-ink-3">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-ink-4">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded", className)} aria-hidden="true" />;
}

/** A full panel of skeleton rows, used while the environment rebuilds. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("space-y-2 p-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key/value list — used in every detail panel
// ---------------------------------------------------------------------------

export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx("divide-y divide-line", className)}>{children}</dl>;
}

export function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[12px] text-ink-3">{label}</dt>
      <dd
        className={cx(
          "min-w-0 truncate text-right text-[12px] text-ink",
          mono && "font-mono tabnum text-[11.5px]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip — CSS-only, so it costs nothing and cannot break hydration
// ---------------------------------------------------------------------------

export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  /**
   * Which edge the bubble hangs from. A centred tooltip on a control near the
   * viewport edge overhangs by half its own width, which is invisible on a wide
   * screen and 27px of clipped text on a phone. `end` pins it to the trigger's
   * right edge so it can only grow inwards.
   */
  align?: "center" | "start" | "end";
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      {/*
        `hidden` rather than `opacity-0`: an absolutely-positioned, always-
        rendered tooltip still contributes to the scroll area, so a nowrap
        tooltip near the right edge silently pushes the whole page into
        horizontal overflow. Toggling display keeps it out of layout entirely.
      */}
      <span
        role="tooltip"
        className={cx(
          "anim-fade-in pointer-events-none absolute z-50 hidden whitespace-nowrap rounded border border-line bg-surface-4 px-2 py-1 text-[11px] text-ink shadow-lg",
          /*
            :focus-visible, not :focus-within. A mouse click focuses the button,
            so focus-within left the tooltip pinned open after the pointer moved
            away. focus-visible fires only for keyboard focus, which keeps the
            tooltip discoverable by tab without stranding it after a click.
          */
          "group-hover/tip:block group-has-[:focus-visible]/tip:block",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — used for pool utilisation, rollout %, remediation progress
// ---------------------------------------------------------------------------

export function Meter({
  value,
  max = 100,
  tone = "accent",
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: "accent" | "ok" | "warn" | "crit";
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-4", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cx(
          "h-full rounded-full transition-all duration-500",
          tone === "accent" && "bg-accent",
          tone === "ok" && "bg-ok",
          tone === "warn" && "bg-warn",
          tone === "crit" && "bg-crit",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
