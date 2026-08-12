"use client";

import Link from "next/link";
import {
  CircuitBoard,
  Gauge,
  Layers,
  Lock,
  TestTube2,
  Zap,
} from "lucide-react";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { SERVICES } from "@/lib/sim/services";
import { ALERT_RULES } from "@/lib/sim/alerts";
import { API_ENDPOINTS } from "@/lib/sim/services";
import { PageIntro } from "@/components/ui/page-intro";
import { Panel, PanelHeader, SectionLabel } from "@/components/ui/primitives";

/**
 * About / portfolio page.
 *
 * Written for two readers with very different budgets: a recruiter skimming for
 * thirty seconds, and an engineer who wants to know whether the interesting
 * problems were actually solved. The scannable summary comes first; the
 * substance follows underneath.
 */

const STACK = [
  { name: "Next.js 16", detail: "App Router, React Server Components boundary, Turbopack" },
  { name: "React 19", detail: "Concurrent rendering, hooks-only components" },
  { name: "TypeScript", detail: "Strict mode, zero `any` in application code" },
  { name: "Tailwind CSS v4", detail: "CSS-first theme with design tokens in @theme" },
  { name: "Zustand", detail: "Single store, narrow selectors to control re-renders" },
  { name: "Recharts", detail: "Time-series and percentile charts" },
  { name: "Vitest", detail: "Unit tests over the simulation engine" },
  { name: "Lucide", detail: "Icon set" },
];

const CHALLENGES = [
  {
    icon: CircuitBoard,
    title: "Making symptoms cohere",
    problem:
      "The easy version of this project sets each panel's data independently, and it falls apart the moment anyone looks closely — the logs say one thing and the charts say another.",
    solution:
      "Everything derives from one metric layer. Scenarios declare metric impacts; service health, alerts, topology edges, API percentiles, log volume and ticket arrival rates are all computed from those metrics. Nothing is set twice, so nothing can disagree.",
  },
  {
    icon: Layers,
    title: "Failure that spreads believably",
    problem:
      "Hard-coding which services break in each scenario means every new scenario has to re-enumerate the whole dependency graph, and the blast radius is only as good as that list.",
    solution:
      "Health cascades along the dependency graph, attenuating one level per hop: an offline dependency makes its callers critical, a critical dependency makes them degraded, and beyond that the effect fades. Soft dependencies — a cache, a queue — only ever degrade. One rule, and a Redis outage looks nothing like a Postgres outage.",
  },
  {
    icon: Gauge,
    title: "Determinism",
    problem:
      "`Math.random()` would mean the same scenario tells a different story every run, and the simulation could not be unit tested at all.",
    solution:
      "Every value comes from a seeded hash of the tick number, so a given tick always produces identical telemetry. Metric noise is interpolated between samples so it wanders like real instrumentation instead of jittering. The engine is pure functions — state in, state out — so tests drive hundreds of simulated seconds without a single timer.",
  },
  {
    icon: Zap,
    title: "History without unbounded memory",
    problem:
      "Storing 24 hours of per-second samples for fifteen services across eight metrics is millions of numbers held in browser memory for no good reason.",
    solution:
      "Four minutes of live samples are retained; anything older is recomputed on demand from the same deterministic baseline model. Memory stays flat regardless of the selected range, and because it is the same model, the synthesised history and the live tail always agree.",
  },
  {
    icon: Lock,
    title: "A terminal that is safe to deploy publicly",
    problem:
      "A network diagnostics console on a public site is an obvious abuse vector if it touches a real socket.",
    solution:
      "`ping`, `dig`, `traceroute`, `nc` and `curl` are answered entirely from in-memory state. No socket, no fetch, no shell — the tools cannot reach anything real. They also disagree with each other in useful ways: during the DNS scenario, `ping` by IP succeeds while `dig` returns SERVFAIL, and that contradiction is the evidence that solves it.",
  },
  {
    icon: TestTube2,
    title: "Alerts that do not flap",
    problem:
      "Firing an alert the instant a threshold is crossed produces a list that thrashes on every noisy sample.",
    solution:
      "Rules are generated from each service's own SLO and carry an evaluation window — a condition must hold for 15–45 seconds before it fires. Critical rules suppress the matching warning rule, so one problem yields one alert.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageIntro
        title="About This Project"
        description="TechOps Command Center is an interactive IT operations and incident-response simulator, built to demonstrate full-stack engineering, systems thinking and interface design in a single artefact."
      />

      {/* At a glance */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          { label: "Simulated services", value: String(SERVICES.length) },
          { label: "Incident scenarios", value: String(SCENARIOS.length) },
          { label: "Alert rules", value: String(ALERT_RULES.length) },
          { label: "Monitored endpoints", value: String(API_ENDPOINTS.length) },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-2 px-4 py-3.5">
            <p className="tabnum font-mono text-[24px] font-semibold text-ink">{stat.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* What it is */}
      <Panel>
        <PanelHeader title="What it does" />
        <div className="space-y-3 p-5 text-[13px] leading-relaxed text-ink-2">
          <p>
            The application simulates the production infrastructure of a fictional SaaS company,
            Meridian Cloud: fifteen services across edge, network, application, platform and data
            tiers, with live metrics, structured logs, threshold alerting, a dependency map, an API
            monitor, a support queue and a release pipeline.
          </p>
          <p>
            The environment starts healthy. A visitor can trigger any of {SCENARIOS.length}{" "}
            incident scenarios and then has to work it like an on-call engineer: read the evidence
            across whichever views are useful, run network diagnostics, commit to a root-cause
            diagnosis, and apply remediation. Only the correct remediation recovers the system.
            The run is scored on accuracy, speed, thoroughness and restraint.
          </p>
          <p className="text-ink-3">
            There is no authentication, no backend and no paid service. Everything runs client-side;
            preferences and personal bests are stored in localStorage.
          </p>
        </div>
      </Panel>

      {/* Architecture */}
      <Panel>
        <PanelHeader
          title="Architecture"
          subtitle="A pure simulation engine underneath a thin presentation layer"
        />
        <div className="overflow-x-auto p-5">
          <ArchitectureDiagram />
        </div>
        <div className="space-y-3 border-t border-line px-5 py-4 text-[12.5px] leading-relaxed text-ink-3">
          <p>
            <span className="font-medium text-ink-2">The engine is pure.</span> `tick(state, dt)`
            takes the world and returns the world one second later. It owns no timers, touches no
            DOM and performs no I/O. The store owns the clock and calls it; a test drives it
            directly. That single boundary is what makes the simulation both testable and
            trivially inspectable.
          </p>
          <p>
            <span className="font-medium text-ink-2">Scenarios are data, not code.</span> Each one
            is a configuration object declaring metric impacts, log templates, ticket templates,
            diagnosis options with per-option coaching, remediation options with consequences, and
            the post-mortem. Adding a scenario means adding one file — the engine, UI, scoring and
            network tools need no changes.
          </p>
        </div>
      </Panel>

      {/* Engineering challenges */}
      <div>
        <SectionLabel className="mb-2.5 block">Problems worth solving</SectionLabel>
        <div className="grid gap-3 md:grid-cols-2">
          {CHALLENGES.map((challenge) => {
            const Icon = challenge.icon;
            return (
              <Panel key={challenge.title} className="p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-3 text-accent">
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">
                    {challenge.title}
                  </h3>
                </div>
                <p className="mt-2.5 text-[12px] leading-relaxed text-ink-4">
                  {challenge.problem}
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
                  {challenge.solution}
                </p>
              </Panel>
            );
          })}
        </div>
      </div>

      {/* Stack */}
      <Panel>
        <PanelHeader title="Technology" subtitle="Chosen for maintainability over novelty" />
        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {STACK.map((item) => (
            <li key={item.name} className="bg-surface-2 px-4 py-2.5">
              <p className="text-[12.5px] font-medium text-ink">{item.name}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-4">{item.detail}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Testing */}
      <Panel>
        <PanelHeader title="Testing strategy" />
        <div className="space-y-3 p-5 text-[12.5px] leading-relaxed text-ink-2">
          <p>
            Tests target the simulation engine rather than the interface, because that is where the
            behaviour that matters lives — and because a pure engine is cheap to test exhaustively.
            The suite covers incident state transitions, metric ramp and recovery curves, service
            health derivation, dependency cascade attenuation, alert evaluation windows, diagnosis
            scoring, remediation gating, and the determinism guarantee itself.
          </p>
          <p className="text-ink-3">
            The determinism test is the load-bearing one: it runs the same scenario twice from a
            fresh state and asserts the two runs produce byte-identical telemetry. If that passes,
            every other test is reproducible; if it fails, none of them mean anything.
          </p>
        </div>
      </Panel>

      {/* What I learned */}
      <Panel>
        <PanelHeader title="What I took from building it" />
        <ul className="divide-y divide-line">
          {[
            {
              title: "Coherence is an architecture problem, not a content problem",
              body: "I initially wrote scenarios that set service statuses directly. It worked and it felt hollow — the numbers next to the statuses did not support them. Reworking it so status is derived from metrics fixed the believability problem and deleted code.",
            },
            {
              title: "The interesting part of an incident is ruling things out",
              body: "Early versions told you 'incorrect' on a wrong diagnosis. Writing per-option feedback that points at the evidence contradicting each hypothesis turned the exercise from a quiz into something that teaches.",
            },
            {
              title: "Animation should carry information",
              body: "Status beacons only pulse when something is wrong. Charts have update animation disabled entirely — on a dashboard that re-renders every second, animating each new sample makes a live system look broken.",
            },
            {
              title: "Determinism pays for itself",
              body: "Seeding all randomness cost an afternoon and made the entire simulation testable, reproducible for demos, and debuggable — I could replay the exact tick where something went wrong.",
            },
          ].map((lesson) => (
            <li key={lesson.title} className="px-5 py-3.5">
              <p className="text-[13px] font-medium text-ink">{lesson.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{lesson.body}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-5 py-4">
        <p className="text-[12.5px] text-ink-3">
          Built by Chad Kraus. Meridian Cloud is fictional; all data is simulated.
        </p>
        <Link
          href="/simulation"
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#6d99ff]"
        >
          <Zap size={13} />
          Try an incident
        </Link>
      </div>
    </div>
  );
}

/**
 * Architecture diagram.
 *
 * Inline SVG rather than an image: it inherits the theme tokens, stays crisp at
 * any zoom, and its text is real text for screen readers and search.
 */
function ArchitectureDiagram() {
  const layers = [
    {
      y: 12,
      label: "Presentation",
      fill: "var(--color-surface-3)",
      items: ["Overview", "Topology", "Logs", "Metrics", "Network", "Support", "Simulation"],
    },
    {
      y: 92,
      label: "State",
      fill: "var(--color-accent-dim)",
      items: ["Zustand store", "tick loop", "selectors", "localStorage prefs"],
    },
    {
      y: 172,
      label: "Engine (pure)",
      fill: "var(--color-surface-4)",
      items: ["tick()", "computeServices()", "evaluateAlerts()", "generateLogs()", "scoreIncident()"],
    },
    {
      y: 252,
      label: "Model",
      fill: "var(--color-surface-3)",
      items: ["service catalogue", "scenarios", "baseline metrics", "seeded RNG"],
    },
  ];

  return (
    <svg
      viewBox="0 0 720 330"
      className="w-full min-w-[560px]"
      role="img"
      aria-label="Layered architecture: presentation reads from a Zustand store, which drives a pure simulation engine built on a deterministic data model."
    >
      {layers.map((layer, index) => (
        <g key={layer.label}>
          <rect
            x={8}
            y={layer.y}
            width={704}
            height={62}
            rx={8}
            fill={layer.fill}
            stroke="var(--color-line)"
            strokeWidth={1}
          />
          <text
            x={24}
            y={layer.y + 25}
            fill="var(--color-ink)"
            fontSize={12}
            fontWeight={600}
            fontFamily="var(--font-sans)"
          >
            {layer.label}
          </text>
          <text
            x={24}
            y={layer.y + 45}
            fill="var(--color-ink-3)"
            fontSize={11}
            fontFamily="var(--font-mono)"
          >
            {layer.items.join("  ·  ")}
          </text>

          {/* Downward arrow between layers */}
          {index < layers.length - 1 ? (
            <g>
              <line
                x1={360}
                y1={layer.y + 62}
                x2={360}
                y2={layer.y + 78}
                stroke="var(--color-ink-4)"
                strokeWidth={1.5}
              />
              <path
                d={`M356 ${layer.y + 74} L360 ${layer.y + 80} L364 ${layer.y + 74}`}
                fill="none"
                stroke="var(--color-ink-4)"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </g>
      ))}

      <text
        x={360}
        y={326}
        textAnchor="middle"
        fill="var(--color-ink-4)"
        fontSize={10.5}
        fontFamily="var(--font-sans)"
      >
        Data flows down; only the store holds mutable state. The engine never imports from the UI.
      </text>
    </svg>
  );
}
