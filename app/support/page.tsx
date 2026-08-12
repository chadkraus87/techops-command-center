"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox } from "lucide-react";
import { cx, formatDateTime, formatRelative } from "@/lib/format";
import { priorityLabel } from "@/lib/sim/tickets";
import { serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Drawer } from "@/components/ui/overlay";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  DetailList,
  DetailRow,
  EmptyState,
  Panel,
  PanelHeader,
  SectionLabel,
  SkeletonRows,
  ToggleGroup,
} from "@/components/ui/primitives";
import type { SupportTicket, TicketPriority } from "@/lib/sim/types";

/**
 * Support Queue.
 *
 * The customer-facing view of an incident, and deliberately the *laggiest* one:
 * tickets only start arriving about half a minute after symptoms begin, because
 * real users retry, wait, and ask a colleague before they write in. Watching the
 * queue fill after the alerts have already fired is the clearest demonstration
 * in the product of why monitoring exists.
 */

const PRIORITY_CLASS: Record<TicketPriority, string> = {
  urgent: "border-crit/30 bg-crit/10 text-crit",
  high: "border-warn/30 bg-warn/10 text-warn",
  normal: "border-info/25 bg-info/10 text-info",
  low: "border-line bg-surface-3 text-ink-3",
};

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

type QueueFilter = "open" | "all" | "urgent" | "incident";

function SupportContent() {
  const searchParams = useSearchParams();
  const ticketParam = searchParams.get("ticket");

  const tickets = useSimStore((s) => s.state.tickets);
  const clock = useSimStore((s) => s.state.clock);
  const incidents = useSimStore((s) => s.state.incidents);
  const activeIncidentId = useSimStore((s) => s.state.active?.incidentId);
  const noteEvidence = useSimStore((s) => s.noteEvidence);

  const [filter, setFilter] = useState<QueueFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(ticketParam);

  useEffect(() => {
    if (activeIncidentId) noteEvidence("tickets:viewed");
  }, [activeIncidentId, noteEvidence]);

  const visible = useMemo(() => {
    return tickets
      .filter((ticket) => {
        switch (filter) {
          case "open":
            return ticket.status !== "resolved";
          case "urgent":
            return ticket.priority === "urgent" || ticket.priority === "high";
          case "incident":
            return Boolean(ticket.incidentId);
          case "all":
            return true;
        }
      })
      .sort((a, b) => {
        const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (rank !== 0) return rank;
        return b.createdAt - a.createdAt;
      });
  }, [tickets, filter]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const open = tickets.filter((t) => t.status !== "resolved");
    return {
      open: open.length,
      urgent: open.filter((t) => t.priority === "urgent").length,
      incidentLinked: open.filter((t) => t.incidentId).length,
      newInLastMinute: tickets.filter((t) => clock - t.createdAt < 60_000).length,
    };
  }, [tickets, clock]);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <PageIntro
        title="Support Queue"
        description="Customer tickets arriving from the live environment. During an incident, volume builds roughly thirty seconds behind the first alert — the delay between a system noticing a problem and a person reporting it."
        actions={
          <ToggleGroup
            label="Filter queue"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "urgent", label: "Urgent" },
              { value: "incident", label: "Incident" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          { label: "Open tickets", value: stats.open },
          { label: "Urgent", value: stats.urgent, tone: "text-crit" },
          { label: "Incident-linked", value: stats.incidentLinked, tone: "text-warn" },
          { label: "Last 60s", value: stats.newInLastMinute, tone: "text-accent" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-2 px-4 py-3">
            <p className="text-[11px] text-ink-3">{stat.label}</p>
            <p
              className={cx(
                "tabnum mt-0.5 font-mono text-[22px] font-semibold",
                stat.tone ?? "text-ink",
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Tickets" meta={`${visible.length}`} />

        {visible.length === 0 ? (
          <EmptyState
            icon={<Inbox size={16} />}
            title="Queue is clear"
            description="No tickets match this filter. During an incident, customer reports will start appearing here."
          />
        ) : (
          <>
            <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 md:flex">
              <span className="w-[86px] shrink-0">ID</span>
              <span className="min-w-0 flex-1">Subject</span>
              <span className="w-[150px] shrink-0">Customer</span>
              <span className="w-[130px] shrink-0">Service</span>
              <span className="w-[72px] shrink-0">Priority</span>
              <span className="w-[90px] shrink-0 text-right">Created</span>
            </div>

            <ul className="max-h-[calc(100dvh-380px)] min-h-[280px] divide-y divide-line overflow-y-auto">
              {visible.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(ticket.id)}
                    className={cx(
                      "w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-3/60",
                      ticket.status === "new" && "bg-accent/[0.035]",
                    )}
                  >
                    <div className="hidden items-center gap-3 md:flex">
                      <span className="tabnum w-[86px] shrink-0 font-mono text-[11px] text-ink-4">
                        {ticket.id}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                        {ticket.subject}
                      </span>
                      <span className="w-[150px] shrink-0 truncate text-[11.5px] text-ink-3">
                        {ticket.company}
                      </span>
                      <span className="w-[130px] shrink-0 truncate text-[11.5px] text-ink-3">
                        {serviceName(ticket.affectedService)}
                      </span>
                      <span className="w-[72px] shrink-0">
                        <span
                          className={cx(
                            "inline-flex rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider",
                            PRIORITY_CLASS[ticket.priority],
                          )}
                        >
                          {ticket.priority}
                        </span>
                      </span>
                      <span className="tabnum w-[90px] shrink-0 text-right font-mono text-[10.5px] text-ink-4">
                        {formatRelative(ticket.createdAt, clock)}
                      </span>
                    </div>

                    <div className="md:hidden">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">
                          {ticket.subject}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase",
                            PRIORITY_CLASS[ticket.priority],
                          )}
                        >
                          {ticket.priority}
                        </span>
                      </div>
                      <p className="tabnum mt-1 font-mono text-[10.5px] text-ink-4">
                        {ticket.id} · {ticket.company} · {formatRelative(ticket.createdAt, clock)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {/* Ticket detail */}
      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.subject ?? ""}
        subtitle={
          selected ? (
            <span className="font-mono text-[11px]">
              {selected.id} · {selected.customer}, {selected.company}
            </span>
          ) : null
        }
        width="md"
      >
        {selected ? <TicketDetail ticket={selected} incidents={incidents} clock={clock} /> : null}
      </Drawer>
    </div>
  );
}

function TicketDetail({
  ticket,
  incidents,
  clock,
}: {
  ticket: SupportTicket;
  incidents: ReturnType<typeof useSimStore.getState>["state"]["incidents"];
  clock: number;
}) {
  const serviceStatus = useSimStore((s) => s.state.services[ticket.affectedService]?.status);
  const incident = incidents.find((i) => i.id === ticket.incidentId);

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cx(
            "inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            PRIORITY_CLASS[ticket.priority],
          )}
        >
          {priorityLabel(ticket.priority)}
        </span>
        <span className="rounded border border-line bg-surface-3 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-3">
          {ticket.status}
        </span>
      </div>

      {/* The report, in the customer's words */}
      <section>
        <SectionLabel className="mb-1.5 block">Customer report</SectionLabel>
        <blockquote className="rounded-md border border-line bg-surface-3/50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
          {ticket.body}
        </blockquote>
      </section>

      <section>
        <SectionLabel className="mb-1 block">Details</SectionLabel>
        <DetailList>
          <DetailRow label="Ticket" value={ticket.id} mono />
          <DetailRow label="Customer" value={ticket.customer} />
          <DetailRow label="Company" value={ticket.company} />
          <DetailRow label="Environment" value={ticket.environment} mono />
          <DetailRow label="Created" value={formatDateTime(ticket.createdAt)} mono />
          <DetailRow label="Age" value={formatRelative(ticket.createdAt, clock)} />
          <DetailRow
            label="Affected service"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Beacon status={serviceStatus ?? "healthy"} />
                {serviceName(ticket.affectedService)}
              </span>
            }
          />
        </DetailList>
      </section>

      {incident ? (
        <section>
          <SectionLabel className="mb-1.5 block">Related incident</SectionLabel>
          <div className="rounded-md border border-crit/25 bg-crit/8 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-ink">
              <span className="font-mono text-[11px] text-crit">{incident.id}</span> ·{" "}
              {incident.title}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
              {incident.customerImpact}
            </p>
          </div>
        </section>
      ) : null}

      <section>
        <SectionLabel className="mb-1.5 block">Suggested troubleshooting</SectionLabel>
        <ol className="space-y-1.5">
          {ticket.suggestedSteps.map((step, index) => (
            <li key={step} className="flex gap-2.5 text-[12px] leading-relaxed text-ink-2">
              <span className="tabnum shrink-0 font-mono text-[10.5px] text-ink-4">
                {index + 1}.
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <SectionLabel className="mb-1.5 block">Internal notes</SectionLabel>
        <ul className="space-y-1.5">
          {ticket.internalNotes.map((note) => (
            <li
              key={note}
              className="rounded-md border border-line bg-surface-3/40 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-3"
            >
              {note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={10} />}>
      <SupportContent />
    </Suspense>
  );
}
