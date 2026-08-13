import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  FlaskConical,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  Network,
  Radio,
  ScrollText,
  Server,
  Siren,
  Waypoints,
} from "lucide-react";

/**
 * Navigation model.
 *
 * Grouped by what the operator is doing rather than by data type: watching the
 * system, responding to it, or changing it. That ordering is also the order a
 * visitor will naturally explore in.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the command palette to explain the destination. */
  description: string;
  /** Single-key shortcut, pressed with the g prefix (g then o). */
  shortcut?: string;
  /**
   * Extra search terms for the command palette.
   *
   * A label and a description are what the page is *called*; these are what
   * people actually type. Searching "topology" should find Infrastructure and
   * "ping" should find Network, even though neither word appears in the name.
   */
  aliases?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: LayoutGrid,
        description: "Global system status, key metrics and live activity",
        aliases: "home dashboard command center status summary",
        shortcut: "o",
      },
      {
        href: "/infrastructure",
        label: "Infrastructure",
        icon: Waypoints,
        description: "Service dependency map and failure blast radius",
        aliases: "topology map graph dependencies nodes blast radius architecture diagram",
        shortcut: "i",
      },
      {
        href: "/services",
        label: "Services",
        icon: Server,
        description: "Service catalogue with ownership, SLOs and health",
        aliases: "catalogue catalog inventory hosts owners slo teams",
        shortcut: "s",
      },
      {
        href: "/metrics",
        label: "Metrics",
        icon: Gauge,
        description: "Observability dashboard across every metric channel",
        aliases: "charts graphs observability cpu memory latency throughput telemetry",
        shortcut: "m",
      },
      {
        href: "/api-monitor",
        label: "API Monitor",
        icon: Activity,
        description: "Endpoint latency percentiles, error rates and samples",
        aliases: "endpoints routes percentiles p95 p99 requests http rest",
        shortcut: "a",
      },
    ],
  },
  {
    label: "Respond",
    items: [
      {
        href: "/incidents",
        label: "Incidents",
        icon: Siren,
        description: "Active and historic incidents with full timelines",
        aliases: "outages postmortem post-mortem timeline history sev root cause",
        shortcut: "n",
      },
      {
        href: "/alerts",
        label: "Alerts",
        icon: AlertTriangle,
        description: "Firing alerts, thresholds and acknowledgement",
        aliases: "alarms warnings thresholds firing paging notifications",
        shortcut: "r",
      },
      {
        href: "/logs",
        label: "Logs",
        icon: ScrollText,
        description: "Live log stream with filtering and structured metadata",
        aliases: "stream tail grep search errors stdout syslog",
        shortcut: "l",
      },
      {
        href: "/network",
        label: "Network",
        icon: Network,
        description: "Network topology and simulated diagnostic tools",
        aliases: "terminal console ping dig traceroute curl dns packet loss shell",
        shortcut: "k",
      },
      {
        href: "/support",
        label: "Support Queue",
        icon: LifeBuoy,
        description: "Customer tickets arriving from the incident",
        aliases: "tickets customers helpdesk queue complaints inbox",
        shortcut: "q",
      },
    ],
  },
  {
    label: "Operate",
    items: [
      {
        href: "/qa-lab",
        label: "QA Lab",
        icon: FlaskConical,
        description: "Deployments, test results, feature flags and known bugs",
        aliases: "deployments releases tests feature flags bugs ci pipeline",
        shortcut: "t",
      },
      {
        href: "/simulation",
        label: "Simulation",
        icon: Radio,
        description: "Trigger an incident and run the investigation workflow",
        aliases: "trigger incident scenario start break outage practice",
        shortcut: "x",
      },
      {
        href: "/about",
        label: "About Project",
        icon: BookOpen,
        description: "How this was built — architecture and engineering notes",
        aliases: "readme docs architecture author stack how it works",
        shortcut: "b",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function navItemFor(pathname: string): NavItem | undefined {
  if (pathname === "/") return ALL_NAV_ITEMS.find((i) => i.href === "/");
  return ALL_NAV_ITEMS.filter((i) => i.href !== "/").find((i) => pathname.startsWith(i.href));
}

/**
 * Routes that exist but are not navigation destinations — you arrive at them
 * from a link, not from the sidebar.
 */
const STANDALONE_ROUTES: Record<string, string> = {
  "/result": "Shared Result",
};

/**
 * The title shown in the top bar. Falling back to "Overview" for an unknown
 * route would actively mislabel the page the visitor is looking at, which
 * matters most for exactly the routes people arrive at from a shared link.
 */
export function pageTitleFor(pathname: string): string {
  const item = navItemFor(pathname);
  if (item) return item.label;
  return STANDALONE_ROUTES[pathname] ?? "TechOps Command Center";
}

/** True where the first-visit dialog would get in the way rather than help. */
export function suppressesOnboarding(pathname: string): boolean {
  return pathname in STANDALONE_ROUTES;
}
