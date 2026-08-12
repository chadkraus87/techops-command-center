"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, LifeBuoy, Rocket, ShieldAlert, Siren } from "lucide-react";
import { cx, formatRelative } from "@/lib/format";
import { serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { EmptyState } from "@/components/ui/primitives";

/**
 * Unified activity feed.
 *
 * Alerts, incident timeline entries, tickets and deployments are separate
 * concepts in the data model but a single story to a human, so they are merged
 * into one chronological stream. During an incident this is the clearest view of
 * cause and effect in the whole product: the alert fires, the timeline records
 * it, and the tickets follow a beat later.
 */

type FeedKind = "alert" | "incident" | "ticket" | "deployment";

interface FeedItem {
  id: string;
  kind: FeedKind;
  timestamp: number;
  title: string;
  detail: string;
  tone: "crit" | "warn" | "info" | "ok";
  href: string;
}

const ICONS = {
  alert: AlertTriangle,
  incident: Siren,
  ticket: LifeBuoy,
  deployment: Rocket,
};

const TONE_CLASS = {
  crit: "border-crit/25 bg-crit/10 text-crit",
  warn: "border-warn/25 bg-warn/10 text-warn",
  info: "border-info/25 bg-info/10 text-info",
  ok: "border-ok/25 bg-ok/10 text-ok",
};

export function ActivityFeed({ limit = 14 }: { limit?: number }) {
  const alerts = useSimStore((s) => s.state.alerts);
  const incidents = useSimStore((s) => s.state.incidents);
  const tickets = useSimStore((s) => s.state.tickets);
  const deployments = useSimStore((s) => s.state.deployments);
  const clock = useSimStore((s) => s.state.clock);

  const items = useMemo<FeedItem[]>(() => {
    const feed: FeedItem[] = [];

    for (const alert of alerts.filter((a) => a.resolvedAt === null).slice(0, 20)) {
      feed.push({
        id: `alert-${alert.id}`,
        kind: "alert",
        timestamp: alert.firedAt,
        title: alert.title,
        detail: alert.detail,
        tone: alert.severity === "critical" ? "crit" : "warn",
        href: "/alerts",
      });
    }

    for (const incident of incidents) {
      // Only the most recent few timeline entries per incident, or the feed
      // becomes a wall of one incident's history.
      for (const event of incident.timeline.slice(-6)) {
        feed.push({
          id: `tl-${event.id}`,
          kind: "incident",
          timestamp: event.timestamp,
          title: event.message,
          detail: `${incident.id} · ${event.actor ?? "System"}`,
          tone:
            event.kind === "resolution" || event.kind === "recovery"
              ? "ok"
              : event.kind === "declaration"
                ? "crit"
                : "info",
          href: `/incidents?id=${incident.id}`,
        });
      }
    }

    for (const ticket of tickets.slice(0, 10)) {
      feed.push({
        id: `ticket-${ticket.id}`,
        kind: "ticket",
        timestamp: ticket.createdAt,
        title: ticket.subject,
        detail: `${ticket.company} · ${serviceName(ticket.affectedService)}`,
        tone: ticket.priority === "urgent" ? "crit" : ticket.priority === "high" ? "warn" : "info",
        href: `/support?ticket=${ticket.id}`,
      });
    }

    for (const deployment of deployments.slice(0, 4)) {
      feed.push({
        id: `dep-${deployment.id}`,
        kind: "deployment",
        timestamp: deployment.deployedAt,
        title: `${serviceName(deployment.service)} ${deployment.version} deployed`,
        detail: `${deployment.author} · ${deployment.testsPassed} tests passed${
          deployment.testsFailed > 0 ? `, ${deployment.testsFailed} failed` : ""
        }`,
        tone: deployment.status === "rolled-back" ? "warn" : "ok",
        href: "/qa-lab",
      });
    }

    return feed.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }, [alerts, incidents, tickets, deployments, limit]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert size={16} />}
        title="No activity yet"
        description="Alerts, incident updates, tickets and deployments will appear here as they happen."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-surface-3/60"
            >
              <span
                className={cx(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                  TONE_CLASS[item.tone],
                )}
              >
                <Icon size={12} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium leading-snug text-ink">
                  {item.title}
                </p>
                <p className="truncate text-[11.5px] leading-snug text-ink-4">{item.detail}</p>
              </div>
              <span className="tabnum shrink-0 whitespace-nowrap font-mono text-[10.5px] text-ink-4">
                {formatRelative(item.timestamp, clock)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
