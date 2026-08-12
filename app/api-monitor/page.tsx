"use client";

import { useEffect, useMemo, useState } from "react";
import { cx, formatCompact, formatInteger, formatLatency, formatPercent, formatTime } from "@/lib/format";
import { allEndpointRuntimes, apiSummary, recentRequests, statusCodeTone } from "@/lib/sim/api";
import { API_ENDPOINTS, serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { Drawer } from "@/components/ui/overlay";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  DetailList,
  DetailRow,
  Panel,
  PanelHeader,
  SectionLabel,
  StatusBadge,
} from "@/components/ui/primitives";
import type { ApiRequestSample } from "@/lib/sim/types";

/**
 * API Monitor.
 *
 * Endpoint statistics derive from the health of whichever service serves the
 * route, so this view can never contradict the rest of the product. That also
 * makes it a genuine diagnostic: when only the endpoints backed by one service
 * turn red, you have localised the fault without opening anything else.
 */

const METHOD_CLASS: Record<string, string> = {
  GET: "border-info/30 bg-info/10 text-info",
  POST: "border-ok/30 bg-ok/10 text-ok",
  PUT: "border-warn/30 bg-warn/10 text-warn",
  DELETE: "border-crit/30 bg-crit/10 text-crit",
};

export default function ApiMonitorPage() {
  const state = useSimStore((s) => s.state);
  const activeIncidentId = useSimStore((s) => s.state.active?.incidentId);
  const noteEvidence = useSimStore((s) => s.noteEvidence);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (activeIncidentId) noteEvidence("api:viewed");
  }, [activeIncidentId, noteEvidence]);

  const runtimes = useMemo(() => allEndpointRuntimes(state), [state]);
  const summary = useMemo(() => apiSummary(state), [state]);

  const selectedEndpoint = API_ENDPOINTS.find((e) => e.id === selectedId) ?? null;
  const selectedRuntime = runtimes.find((r) => r.id === selectedId) ?? null;
  const samples = useMemo(
    () => (selectedEndpoint ? recentRequests(selectedEndpoint, state, 20) : []),
    [selectedEndpoint, state],
  );

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <PageIntro
        title="API Monitor"
        description="Per-endpoint latency percentiles, throughput and error rates. Select any endpoint to inspect recent requests and their payloads."
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-5">
        {[
          { label: "Requests / min", value: formatInteger(summary.totalRpm) },
          {
            label: "Success rate",
            value: formatPercent(summary.successRate, 2),
            tone: summary.successRate < 0.98 ? "text-warn" : "text-ok",
          },
          { label: "Worst p99", value: formatLatency(summary.worstP99) },
          {
            label: "Degraded",
            value: String(summary.degraded),
            tone: summary.degraded > 0 ? "text-warn" : undefined,
          },
          {
            label: "Failing",
            value: String(summary.failing),
            tone: summary.failing > 0 ? "text-crit" : undefined,
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-2 px-4 py-3">
            <p className="text-[11px] text-ink-3">{stat.label}</p>
            <p
              className={cx(
                "tabnum mt-0.5 font-mono text-[19px] font-semibold",
                stat.tone ?? "text-ink",
              )}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Endpoints" meta={`${API_ENDPOINTS.length}`} />

        <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4 lg:flex">
          <span className="w-[64px] shrink-0">Method</span>
          <span className="min-w-0 flex-1">Endpoint</span>
          <span className="w-[92px] shrink-0">Status</span>
          <span className="w-[74px] shrink-0 text-right">Req/min</span>
          <span className="w-[68px] shrink-0 text-right">p50</span>
          <span className="w-[68px] shrink-0 text-right">p95</span>
          <span className="w-[68px] shrink-0 text-right">p99</span>
          <span className="w-[76px] shrink-0 text-right">Success</span>
        </div>

        <ul className="divide-y divide-line">
          {API_ENDPOINTS.map((endpoint) => {
            const runtime = runtimes.find((r) => r.id === endpoint.id);
            if (!runtime) return null;

            return (
              <li key={endpoint.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(endpoint.id)}
                  className="w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-3/60"
                >
                  <div className="hidden items-center gap-3 lg:flex">
                    <span className="w-[64px] shrink-0">
                      <span
                        className={cx(
                          "inline-flex rounded border px-1.5 py-px font-mono text-[9.5px] font-bold",
                          METHOD_CLASS[endpoint.method],
                        )}
                      >
                        {endpoint.method}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] text-ink">
                        {endpoint.path}
                      </span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {serviceName(endpoint.service)}
                      </span>
                    </span>
                    <span className="w-[92px] shrink-0">
                      <StatusBadge status={runtime.status} />
                    </span>
                    <span className="tabnum w-[74px] shrink-0 text-right font-mono text-[11.5px] text-ink-2">
                      {formatCompact(runtime.requestsPerMin)}
                    </span>
                    <span className="tabnum w-[68px] shrink-0 text-right font-mono text-[11.5px] text-ink-3">
                      {formatLatency(runtime.p50)}
                    </span>
                    <span className="tabnum w-[68px] shrink-0 text-right font-mono text-[11.5px] text-ink-3">
                      {formatLatency(runtime.p95)}
                    </span>
                    <span
                      className={cx(
                        "tabnum w-[68px] shrink-0 text-right font-mono text-[11.5px]",
                        runtime.p99 > 2000 ? "text-warn" : "text-ink-3",
                      )}
                    >
                      {formatLatency(runtime.p99)}
                    </span>
                    <span
                      className={cx(
                        "tabnum w-[76px] shrink-0 text-right font-mono text-[11.5px]",
                        runtime.errorRate > 0.02 ? "text-crit" : "text-ink-2",
                      )}
                    >
                      {formatPercent(1 - runtime.errorRate, 2)}
                    </span>
                  </div>

                  <div className="lg:hidden">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "shrink-0 rounded border px-1.5 py-px font-mono text-[9.5px] font-bold",
                          METHOD_CLASS[endpoint.method],
                        )}
                      >
                        {endpoint.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                        {endpoint.path}
                      </span>
                      <Beacon status={runtime.status} />
                    </div>
                    <div className="tabnum mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-ink-4">
                      <span>p50 {formatLatency(runtime.p50)}</span>
                      <span>p99 {formatLatency(runtime.p99)}</span>
                      <span>{formatPercent(1 - runtime.errorRate, 1)} ok</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* Endpoint detail */}
      <Drawer
        open={selectedEndpoint !== null}
        onClose={() => setSelectedId(null)}
        width="lg"
        title={
          selectedEndpoint ? (
            <span className="flex items-center gap-2 font-mono text-[14px]">
              <span
                className={cx(
                  "rounded border px-1.5 py-px text-[10px] font-bold",
                  METHOD_CLASS[selectedEndpoint.method],
                )}
              >
                {selectedEndpoint.method}
              </span>
              {selectedEndpoint.path}
            </span>
          ) : (
            ""
          )
        }
        subtitle={selectedEndpoint ? serviceName(selectedEndpoint.service) : null}
      >
        {selectedEndpoint && selectedRuntime ? (
          <div className="space-y-5 p-5">
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              {selectedEndpoint.description}
            </p>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
              {[
                { label: "p50", value: formatLatency(selectedRuntime.p50) },
                { label: "p95", value: formatLatency(selectedRuntime.p95) },
                { label: "p99", value: formatLatency(selectedRuntime.p99) },
                {
                  label: "Errors",
                  value: formatPercent(selectedRuntime.errorRate, 2),
                },
              ].map((stat) => (
                <div key={stat.label} className="bg-surface-2 px-3 py-2.5">
                  <p className="text-[10.5px] text-ink-4">{stat.label}</p>
                  <p className="tabnum mt-0.5 font-mono text-[15px] font-medium text-ink">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            <section>
              <SectionLabel className="mb-1 block">Routing</SectionLabel>
              <DetailList>
                <DetailRow label="Served by" value={serviceName(selectedEndpoint.service)} />
                <DetailRow
                  label="Traffic share"
                  value={formatPercent(selectedEndpoint.trafficShare, 1)}
                  mono
                />
                <DetailRow
                  label="Requests / min"
                  value={formatInteger(selectedRuntime.requestsPerMin)}
                  mono
                />
              </DetailList>
            </section>

            <section>
              <SectionLabel className="mb-1.5 block">Recent requests</SectionLabel>
              <div className="overflow-hidden rounded-md border border-line">
                <ul className="divide-y divide-line/60">
                  {samples.map((sample) => (
                    <RequestRow key={sample.id} sample={sample} />
                  ))}
                </ul>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function RequestRow({ sample }: { sample: ApiRequestSample }) {
  const [expanded, setExpanded] = useState(false);
  const tone = statusCodeTone(sample.statusCode);

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-surface-3/60"
      >
        <span className="tabnum shrink-0 text-ink-4">{formatTime(sample.timestamp)}</span>
        <span
          className={cx(
            "tabnum w-9 shrink-0 font-semibold",
            tone === "ok" && "text-ok",
            tone === "warn" && "text-warn",
            tone === "crit" && "text-crit",
          )}
        >
          {sample.statusCode}
        </span>
        <span
          className={cx(
            "tabnum w-16 shrink-0 text-right",
            sample.durationMs > 2000 ? "text-warn" : "text-ink-3",
          )}
        >
          {formatLatency(sample.durationMs)}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-4">{sample.requestId}</span>
        <span className="hidden shrink-0 text-ink-4 sm:inline">{sample.region}</span>
      </button>
      {expanded ? (
        <pre className="overflow-x-auto border-t border-line bg-void/70 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-2">
          {sample.responseBody}
        </pre>
      ) : null}
    </li>
  );
}
