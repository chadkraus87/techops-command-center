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
        shortcut: "o",
      },
      {
        href: "/infrastructure",
        label: "Infrastructure",
        icon: Waypoints,
        description: "Service dependency map and failure blast radius",
        shortcut: "i",
      },
      {
        href: "/services",
        label: "Services",
        icon: Server,
        description: "Service catalogue with ownership, SLOs and health",
        shortcut: "s",
      },
      {
        href: "/metrics",
        label: "Metrics",
        icon: Gauge,
        description: "Observability dashboard across every metric channel",
        shortcut: "m",
      },
      {
        href: "/api-monitor",
        label: "API Monitor",
        icon: Activity,
        description: "Endpoint latency percentiles, error rates and samples",
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
        shortcut: "n",
      },
      {
        href: "/alerts",
        label: "Alerts",
        icon: AlertTriangle,
        description: "Firing alerts, thresholds and acknowledgement",
        shortcut: "r",
      },
      {
        href: "/logs",
        label: "Logs",
        icon: ScrollText,
        description: "Live log stream with filtering and structured metadata",
        shortcut: "l",
      },
      {
        href: "/network",
        label: "Network",
        icon: Network,
        description: "Network topology and simulated diagnostic tools",
        shortcut: "k",
      },
      {
        href: "/support",
        label: "Support Queue",
        icon: LifeBuoy,
        description: "Customer tickets arriving from the incident",
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
        shortcut: "t",
      },
      {
        href: "/simulation",
        label: "Simulation",
        icon: Radio,
        description: "Trigger an incident and run the investigation workflow",
        shortcut: "x",
      },
      {
        href: "/about",
        label: "About Project",
        icon: BookOpen,
        description: "How this was built — architecture and engineering notes",
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
