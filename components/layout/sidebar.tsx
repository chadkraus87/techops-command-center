"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, X } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";
import { cx } from "@/lib/format";
import { useSimStore } from "@/lib/store/sim-store";
import { summariseFleet } from "@/lib/sim/metrics";
import { Beacon, SectionLabel } from "@/components/ui/primitives";

/**
 * Left navigation.
 *
 * Two details do real work here: each item that has something wrong beneath it
 * carries a live count, so the sidebar doubles as a triage surface; and the
 * whole thing is a landmark <nav> with a current-page marker for screen readers.
 */

export function Sidebar({
  mobileOpen,
  onCloseMobile,
  onOpenPalette,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();

  // Narrow subscriptions: these change every tick, the rest of the nav does not.
  const activeIncidents = useSimStore((s) => s.state.incidents.filter((i) => i.status !== "resolved").length);
  const openAlerts = useSimStore(
    (s) => s.state.alerts.filter((a) => a.resolvedAt === null && !a.acknowledged).length,
  );
  const newTickets = useSimStore((s) => s.state.tickets.filter((t) => t.status === "new").length);
  const services = useSimStore((s) => s.state.services);
  const unhealthy = Object.values(services).filter((s) => s.status !== "healthy").length;

  const badges: Record<string, number> = {
    "/incidents": activeIncidents,
    "/alerts": openAlerts,
    "/support": newTickets,
    "/services": unhealthy,
    "/infrastructure": unhealthy,
  };

  const fleet = summariseFleet(services);

  return (
    <>
      {/* Scrim for the mobile drawer */}
      {mobileOpen ? (
        <div
          className="anim-fade-in fixed inset-0 z-40 bg-void/70 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}

      <nav
        aria-label="Primary"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col border-r border-line bg-surface-2/95 backdrop-blur-md transition-transform duration-200 lg:translate-x-0",
          "lg:sticky lg:top-0 lg:z-30 lg:h-dvh lg:bg-surface-2/60",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-2 shadow-[0_2px_8px_-2px_rgba(91,140,255,0.6)]">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-white" aria-hidden="true">
              <path
                d="M2 11.5 L5.2 11.5 L6.6 7.2 L8.4 13 L10 9.4 L11.2 11.5 L14 11.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-ink">
              TechOps
            </p>
            <p className="truncate text-[10px] leading-tight text-ink-4">Command Center</p>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="-mr-1 rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink lg:hidden"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Command palette trigger */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] text-ink-4 transition-colors hover:border-line hover:bg-surface-3 hover:text-ink-3"
          >
            <Command size={13} className="shrink-0" />
            <span className="flex-1">Search…</span>
            <kbd className="rounded border border-line bg-surface-3 px-1 py-0.5 font-mono text-[9px] text-ink-4">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Groups */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <SectionLabel className="px-2">{group.label}</SectionLabel>
              <ul className="mt-1.5 space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const badge = badges[item.href] ?? 0;
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-150",
                          active
                            ? "bg-surface-4 font-medium text-ink"
                            : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                        )}
                      >
                        {/* Active marker rail */}
                        <span
                          aria-hidden="true"
                          className={cx(
                            "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity",
                            active ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <Icon
                          size={15}
                          className={cx(
                            "shrink-0 transition-colors",
                            active ? "text-accent" : "text-ink-4 group-hover:text-ink-3",
                          )}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge > 0 ? (
                          <span className="tabnum inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-crit/15 px-1 font-mono text-[10px] font-medium text-crit">
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer status strip */}
        <div className="shrink-0 border-t border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Beacon
              status={
                fleet.status === "operational"
                  ? "healthy"
                  : fleet.status === "degraded"
                    ? "degraded"
                    : "critical"
              }
            />
            <span className="text-[11px] font-medium text-ink-2">
              {fleet.servicesOnline}/{fleet.servicesTotal} services online
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-tight text-ink-4">
            Meridian Cloud · us-east-1
          </p>
        </div>
      </nav>
    </>
  );
}
