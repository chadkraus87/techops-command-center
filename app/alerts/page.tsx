"use client";

import { useEffect, useMemo, useState } from "react";
import { BellOff, Check, ShieldAlert } from "lucide-react";
import { cx, formatDuration, formatRelative, formatTime } from "@/lib/format";
import { ALERT_RULES, sortAlerts } from "@/lib/sim/alerts";
import { serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  SectionLabel,
  ToggleGroup,
} from "@/components/ui/primitives";

/**
 * Alert Center.
 *
 * Shows the rule behind every alert, not just the alert. Seeing "error rate >
 * 4× SLO, sustained for 20s" next to the firing alert is what turns a red row
 * into something an operator can reason about — and it makes the evaluation
 * window visible, which explains why alerts lag the metric that caused them.
 */

type AlertFilter = "active" | "critical" | "acknowledged" | "resolved";

export default function AlertsPage() {
  const [filter, setFilter] = useState<AlertFilter>("active");

  const alerts = useSimStore((s) => s.state.alerts);
  const clock = useSimStore((s) => s.state.clock);
  const acknowledge = useSimStore((s) => s.acknowledge);
  const activeIncidentId = useSimStore((s) => s.state.active?.incidentId);
  const noteEvidence = useSimStore((s) => s.noteEvidence);

  useEffect(() => {
    if (activeIncidentId) noteEvidence("alerts:viewed");
  }, [activeIncidentId, noteEvidence]);

  const visible = useMemo(() => {
    const list = alerts.filter((alert) => {
      switch (filter) {
        case "active":
          return alert.resolvedAt === null && !alert.acknowledged;
        case "critical":
          return alert.resolvedAt === null && alert.severity === "critical";
        case "acknowledged":
          return alert.resolvedAt === null && alert.acknowledged;
        case "resolved":
          return alert.resolvedAt !== null;
      }
    });
    return sortAlerts(list);
  }, [alerts, filter]);

  const counts = useMemo(() => {
    const open = alerts.filter((a) => a.resolvedAt === null);
    return {
      critical: open.filter((a) => a.severity === "critical").length,
      warning: open.filter((a) => a.severity === "warning").length,
      acknowledged: open.filter((a) => a.acknowledged).length,
      resolved: alerts.filter((a) => a.resolvedAt !== null).length,
    };
  }, [alerts]);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <PageIntro
        title="Alert Center"
        description="Threshold alerts evaluated every second against live service metrics. Each rule must hold for a sustained window before it fires, which keeps transient spikes out of the queue."
        actions={
          <ToggleGroup
            label="Filter alerts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "critical", label: "Critical" },
              { value: "acknowledged", label: "Acked" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
        }
      />

      {/* Counters */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          { label: "Critical", value: counts.critical, tone: "text-crit" },
          { label: "Warning", value: counts.warning, tone: "text-warn" },
          { label: "Acknowledged", value: counts.acknowledged, tone: "text-ink-2" },
          { label: "Resolved", value: counts.resolved, tone: "text-ok" },
        ].map((counter) => (
          <div key={counter.label} className="bg-surface-2 px-4 py-3">
            <p className="text-[11px] text-ink-3">{counter.label}</p>
            <p className={cx("tabnum mt-0.5 font-mono text-[22px] font-semibold", counter.tone)}>
              {counter.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title={
              filter === "active"
                ? "Active alerts"
                : filter === "critical"
                  ? "Critical alerts"
                  : filter === "acknowledged"
                    ? "Acknowledged"
                    : "Resolved alerts"
            }
            meta={`${visible.length}`}
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={filter === "resolved" ? <Check size={16} /> : <BellOff size={16} />}
              title={
                filter === "resolved" ? "Nothing resolved yet" : "No alerts in this view"
              }
              description={
                filter === "active"
                  ? "Every metric is within its threshold. Alerts will appear here the moment a condition holds long enough to fire."
                  : "Adjust the filter to see other alerts."
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((alert) => {
                const rule = ALERT_RULES.find((r) => r.id === alert.ruleId);
                const duration = ((alert.resolvedAt ?? clock) - alert.firedAt) / 1000;

                return (
                  <li
                    key={alert.id}
                    className={cx(
                      "flex flex-wrap items-start gap-3 px-4 py-3",
                      alert.resolvedAt !== null && "opacity-60",
                    )}
                  >
                    <span
                      className={cx(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                        alert.severity === "critical"
                          ? "border-crit/30 bg-crit/12 text-crit"
                          : "border-warn/30 bg-warn/12 text-warn",
                      )}
                    >
                      <ShieldAlert size={12} aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-medium text-ink">{alert.title}</p>
                        <span
                          className={cx(
                            "rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider",
                            alert.severity === "critical"
                              ? "border-crit/30 text-crit"
                              : "border-warn/30 text-warn",
                          )}
                        >
                          {alert.severity}
                        </span>
                        {alert.acknowledged ? (
                          <span className="rounded border border-line px-1.5 py-px text-[9.5px] uppercase tracking-wider text-ink-4">
                            acked
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-0.5 text-[12px] text-ink-3">{alert.detail}</p>

                      <div className="tabnum mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-ink-4">
                        <span>{serviceName(alert.service)}</span>
                        <span>fired {formatTime(alert.firedAt)}</span>
                        <span>{formatDuration(duration)}</span>
                        {rule ? <span>held {rule.forSeconds}s before firing</span> : null}
                        {alert.incidentId ? (
                          <span className="text-accent">{alert.incidentId}</span>
                        ) : null}
                      </div>
                    </div>

                    {alert.resolvedAt === null && !alert.acknowledged ? (
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => acknowledge(alert.id)}
                        icon={<Check size={12} />}
                      >
                        Ack
                      </Button>
                    ) : alert.resolvedAt !== null ? (
                      <span className="tabnum shrink-0 font-mono text-[10.5px] text-ok">
                        cleared {formatRelative(alert.resolvedAt, clock)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Rule reference */}
        <Panel className="hidden xl:block">
          <PanelHeader title="Alert rules" meta={`${ALERT_RULES.length}`} />
          <div className="px-4 py-3">
            <p className="text-[11.5px] leading-relaxed text-ink-4">
              Rules are generated from each service&rsquo;s own SLO, so the alerting policy stays
              consistent with the health model rather than drifting from it.
            </p>
            <SectionLabel className="mb-1.5 mt-4 block">Rule shape</SectionLabel>
            <pre className="overflow-x-auto rounded-md border border-line bg-void/70 p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-3">
              {`{
  service:   "customer-api",
  metric:    "errorRate",
  comparator:"gt",
  threshold: 0.04,   // 4× SLO
  severity:  "critical",
  forSeconds: 20
}`}
            </pre>
            <SectionLabel className="mb-1.5 mt-4 block">Suppression</SectionLabel>
            <p className="text-[11.5px] leading-relaxed text-ink-4">
              When a critical rule fires, the matching warning rule for the same service and metric
              is suppressed — one problem produces one alert.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
