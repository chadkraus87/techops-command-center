"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/format";

/**
 * Page introduction.
 *
 * Every section gets one sentence explaining what it is for. In a portfolio
 * piece the visitor has no onboarding and no colleague to ask, so a page that
 * explains itself in a line is worth more than one extra chart.
 */
export function PageIntro({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
          {meta}
        </div>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
