"use client";

import { useState } from "react";
import { Bug, CheckCircle2, GitBranch, Rocket, XCircle } from "lucide-react";
import { cx, formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import {
  ENVIRONMENTS,
  FEATURE_FLAGS,
  seedKnownBugs,
  TEST_SUITES,
} from "@/lib/sim/deployments";
import { serviceName } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";
import { PageIntro } from "@/components/ui/page-intro";
import {
  Beacon,
  Button,
  Meter,
  Panel,
  PanelHeader,
  SectionLabel,
} from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import type { Deployment } from "@/lib/sim/types";

/**
 * QA Lab.
 *
 * The point of this page is the link between release quality and production
 * incidents. Shipping the release with two failing tests and high regression
 * risk does not warn you and does not fail — it succeeds, looks fine, and then
 * degrades the environment a few minutes later. That gap is the lesson.
 */

const RISK_CLASS = {
  low: "border-ok/25 bg-ok/10 text-ok",
  medium: "border-warn/25 bg-warn/10 text-warn",
  high: "border-crit/25 bg-crit/10 text-crit",
};

const DEPLOY_STATUS_CLASS: Record<Deployment["status"], string> = {
  succeeded: "text-ok",
  failed: "text-crit",
  "rolled-back": "text-warn",
  running: "text-info",
};

export default function QaLabPage() {
  const deployments = useSimStore((s) => s.state.deployments);
  const clock = useSimStore((s) => s.state.clock);
  const hasActiveIncident = useSimStore((s) => s.state.active !== null);
  const scheduledFailure = useSimStore((s) => s.state.scheduledFailure);
  const deploy = useSimStore((s) => s.deploy);

  const [confirmRisky, setConfirmRisky] = useState(false);
  const knownBugs = seedKnownBugs(clock);

  const totalPassed = TEST_SUITES.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = TEST_SUITES.reduce((sum, s) => sum + s.failed, 0);
  const totalDuration = TEST_SUITES.reduce((sum, s) => sum + s.durationSeconds, 0);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
      <PageIntro
        title="QA Lab"
        description="Release pipeline, test results, feature flags and known defects. Deploying the risky release will succeed — and then destabilise production a few minutes later."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Rocket size={13} />}
              disabled={hasActiveIncident || scheduledFailure !== null}
              onClick={() => deploy("customer-api", false)}
            >
              Deploy safe release
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Rocket size={13} />}
              disabled={hasActiveIncident || scheduledFailure !== null}
              onClick={() => setConfirmRisky(true)}
            >
              Deploy risky release
            </Button>
          </div>
        }
      />

      {scheduledFailure ? (
        <div className="flex items-center gap-3 rounded-lg border border-warn/30 bg-warn/8 px-4 py-3">
          <span className="beacon beacon-pulse bg-warn" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-warn">
              Media Service v3.14.2 is rolling out
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">
              Deployment reported success. Watch memory on the media service over the next few
              minutes — the regression is not visible immediately.
            </p>
          </div>
          <span className="tabnum shrink-0 font-mono text-[11px] text-ink-4">
            {formatDuration(scheduledFailure.inSeconds)}
          </span>
        </div>
      ) : null}

      {/* Environments */}
      <div className="grid gap-4 lg:grid-cols-4">
        {ENVIRONMENTS.map((environment) => (
          <Panel key={environment.name} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>{environment.name}</SectionLabel>
              <Beacon status={environment.status === "healthy" ? "healthy" : "degraded"} />
            </div>
            <p className="mt-2 font-mono text-[14px] font-medium text-ink">{environment.version}</p>
            <p className="mt-0.5 text-[11px] text-ink-4">{environment.region}</p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Deployments */}
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Deployment history"
            subtitle="Most recent first — the first question in any investigation"
            meta={`${deployments.length}`}
          />
          <ul className="divide-y divide-line">
            {deployments.slice(0, 8).map((deployment) => (
              <li key={deployment.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <GitBranch size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
                  <span className="text-[12.5px] font-medium text-ink">
                    {serviceName(deployment.service)}
                  </span>
                  <span className="tabnum font-mono text-[11.5px] text-accent">
                    v{deployment.version}
                  </span>
                  <span
                    className={cx(
                      "text-[11px] font-medium capitalize",
                      DEPLOY_STATUS_CLASS[deployment.status],
                    )}
                  >
                    {deployment.status}
                  </span>
                  <span
                    className={cx(
                      "rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider",
                      RISK_CLASS[deployment.regressionRisk],
                    )}
                  >
                    {deployment.regressionRisk} risk
                  </span>
                  <span className="tabnum ml-auto font-mono text-[10.5px] text-ink-4">
                    {formatRelative(deployment.deployedAt, clock)}
                  </span>
                </div>

                <div className="tabnum mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-ink-4">
                  <span className="text-ok">{deployment.testsPassed} passed</span>
                  {deployment.testsFailed > 0 ? (
                    <span className="text-crit">{deployment.testsFailed} failed</span>
                  ) : null}
                  <span>{deployment.coverage.toFixed(1)}% coverage</span>
                  <span>{deployment.author}</span>
                  <span className="hidden sm:inline">{formatDateTime(deployment.deployedAt)}</span>
                </div>

                <ul className="mt-1.5 space-y-0.5">
                  {deployment.changelog.map((entry) => (
                    <li key={entry} className="flex gap-2 text-[11.5px] leading-snug text-ink-3">
                      <span className="text-ink-4" aria-hidden="true">
                        ·
                      </span>
                      {entry}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          {/* Test suites */}
          <Panel>
            <PanelHeader
              title="Test suites"
              subtitle={`${totalPassed} passing · ${totalFailed} failing · ${formatDuration(totalDuration)}`}
            />
            <ul className="divide-y divide-line">
              {TEST_SUITES.map((suite) => {
                const total = suite.passed + suite.failed;
                const passRate = total > 0 ? suite.passed / total : 1;
                return (
                  <li key={suite.name} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {suite.failed === 0 ? (
                        <CheckCircle2 size={13} className="shrink-0 text-ok" aria-hidden="true" />
                      ) : (
                        <XCircle size={13} className="shrink-0 text-crit" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                        {suite.name}
                      </span>
                      <span className="tabnum shrink-0 font-mono text-[11px] text-ink-3">
                        {suite.passed}
                        {suite.failed > 0 ? (
                          <span className="text-crit"> / {suite.failed}</span>
                        ) : null}
                      </span>
                    </div>
                    <Meter
                      className="mt-1.5"
                      value={passRate * 100}
                      tone={suite.failed === 0 ? "ok" : "crit"}
                      label={`${suite.name} pass rate`}
                    />
                  </li>
                );
              })}
            </ul>
          </Panel>

          {/* Feature flags */}
          <Panel>
            <PanelHeader title="Feature flags" meta={`${FEATURE_FLAGS.length}`} />
            <ul className="divide-y divide-line">
              {FEATURE_FLAGS.map((flag) => (
                <li key={flag.key} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        flag.enabled ? "bg-ok" : "bg-idle",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                      {flag.key}
                    </span>
                    <span className="tabnum shrink-0 font-mono text-[10.5px] text-ink-4">
                      {flag.enabled ? `${flag.rollout}%` : "off"}
                    </span>
                  </div>
                  <p className="mt-0.5 pl-3.5 text-[11px] leading-snug text-ink-4">
                    {flag.description}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Known bugs */}
          <Panel>
            <PanelHeader title="Known defects" meta={`${knownBugs.length}`} />
            <ul className="divide-y divide-line">
              {knownBugs.map((bug) => (
                <li key={bug.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <Bug size={13} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-snug text-ink-2">{bug.title}</p>
                    <p className="tabnum mt-0.5 font-mono text-[10.5px] text-ink-4">
                      {bug.id} · {serviceName(bug.service)} · {bug.status}
                    </p>
                  </div>
                  <span
                    className={cx(
                      "shrink-0 rounded border px-1.5 py-px text-[9.5px] font-bold",
                      bug.severity === "P1"
                        ? "border-crit/30 text-crit"
                        : bug.severity === "P2"
                          ? "border-warn/30 text-warn"
                          : "border-line text-ink-4",
                    )}
                  >
                    {bug.severity}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRisky}
        onClose={() => setConfirmRisky(false)}
        onConfirm={() => deploy("media-service", true)}
        title="Deploy Media Service v3.14.2?"
        description="216 passed, 2 failed, 81.4% coverage, high regression risk. The pipeline will let this through — that is the point."
        confirmLabel="Deploy anyway"
        destructive
      />
    </div>
  );
}
