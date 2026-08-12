import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

/**
 * Fonts are self-hosted through the `geist` package rather than fetched from
 * Google Fonts at build time — no network dependency in CI, and no third-party
 * request from the deployed page.
 */

export const metadata: Metadata = {
  title: {
    default: "TechOps Command Center",
    template: "%s · TechOps Command Center",
  },
  description:
    "An interactive IT operations and incident-response simulator. Monitor a simulated infrastructure, trigger incidents, investigate the evidence, diagnose the root cause and restore service.",
  applicationName: "TechOps Command Center",
  authors: [{ name: "Chad Kraus" }],
  keywords: [
    "incident response",
    "site reliability engineering",
    "observability",
    "IT operations",
    "network operations center",
    "simulation",
  ],
  openGraph: {
    title: "TechOps Command Center",
    description:
      "Monitor a simulated infrastructure, trigger incidents, investigate and restore service.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
