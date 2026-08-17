"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ALL_NAV_ITEMS, suppressesOnboarding } from "@/lib/nav";
import { usePreferences } from "@/lib/store/prefs";
import { useSimStore } from "@/lib/store/sim-store";
import { CommandPalette } from "./command-palette";
import { Onboarding } from "./onboarding";
import { Sidebar } from "./sidebar";
import { ThemeApplier } from "./theme-applier";
import { ToastViewport } from "./toasts";
import { Topbar } from "./topbar";

/**
 * Application shell.
 *
 * Owns three global concerns:
 *  1. The tick loop — a single interval for the whole application. Its period is
 *     derived from the simulation speed, and it is torn down on every change, so
 *     there is exactly one timer alive at any moment and none survive unmount.
 *  2. Global keyboard shortcuts — ⌘K for the palette, and `g` followed by a
 *     letter to jump between sections.
 *  3. Optional alert audio, synthesised rather than loaded, so there is no
 *     asset to download and nothing can autoplay.
 */

/** Real milliseconds between ticks at 1×. */
const TICK_INTERVAL_MS = 1000;

/**
 * How often the running simulation is written to sessionStorage. Serialising
 * every tick would be wasteful for no benefit; five seconds bounds the worst
 * case a reload can lose, and a `pagehide` flush catches the rest.
 */
const PERSIST_INTERVAL_MS = 5000;

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { prefs, loaded, update } = usePreferences();

  const tick = useSimStore((s) => s.tick);
  const speed = useSimStore((s) => s.state.speed);
  const running = useSimStore((s) => s.state.running);
  const hydrate = useSimStore((s) => s.hydrate);
  const persist = useSimStore((s) => s.persist);

  // --- Session restore --------------------------------------------------
  // Runs in an effect rather than during store creation so the server-rendered
  // markup and the first client render always match; the restored state lands
  // one frame later.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // --- Session save -----------------------------------------------------
  useEffect(() => {
    const interval = window.setInterval(persist, PERSIST_INTERVAL_MS);

    // `pagehide` fires on reload, navigation and tab close — including the
    // bfcache path on iOS, where `beforeunload` is unreliable.
    const flush = () => persist();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      // Capture the final state on unmount too.
      persist();
    };
  }, [persist]);

  // --- Tick loop --------------------------------------------------------
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      // Advancing simulated time by the speed factor (rather than ticking more
      // often) keeps the work per second constant at every speed setting.
      tick(speed);
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [tick, speed, running]);

  // --- Alert audio ------------------------------------------------------
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastCriticalCount = useRef(0);
  const criticalAlerts = useSimStore(
    (s) => s.state.alerts.filter((a) => a.resolvedAt === null && a.severity === "critical").length,
  );

  useEffect(() => {
    if (!prefs.soundEnabled) {
      lastCriticalCount.current = criticalAlerts;
      return;
    }
    if (criticalAlerts <= lastCriticalCount.current) {
      lastCriticalCount.current = criticalAlerts;
      return;
    }
    lastCriticalCount.current = criticalAlerts;

    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioContextRef.current ??= new Ctx();
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") void ctx.resume();

      // A short two-tone chirp: audible, brief, and nothing like a klaxon.
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(660, now + 0.16);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.44);
    } catch {
      // Audio is a nicety — never let it break the interface.
    }
  }, [criticalAlerts, prefs.soundEnabled]);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  // --- Keyboard shortcuts ------------------------------------------------
  const pendingGoto = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "g") {
        pendingGoto.current = true;
        window.setTimeout(() => {
          pendingGoto.current = false;
        }, 1200);
        return;
      }

      if (pendingGoto.current) {
        const match = ALL_NAV_ITEMS.find((item) => item.shortcut === event.key.toLowerCase());
        pendingGoto.current = false;
        if (match) {
          event.preventDefault();
          router.push(match.href);
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <div className="relative flex min-h-dvh">
      <ThemeApplier />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      <Sidebar
        mobileOpen={mobileNavOpen}
        onCloseMobile={closeMobileNav}
        onOpenPalette={openPalette}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenMobileNav={() => setMobileNavOpen(true)}
          soundEnabled={prefs.soundEnabled}
          onToggleSound={() => update({ soundEnabled: !prefs.soundEnabled })}
          theme={prefs.theme}
          onToggleTheme={() => update({ theme: prefs.theme === "light" ? "dark" : "light" })}
        />
        <main id="main" className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-5 lg:px-6">
          {children}
        </main>
      </div>

      {paletteOpen ? <CommandPalette onClose={closePalette} /> : null}
      <ToastViewport />

      {/* A shared result link exists to show that result. Opening a generic
          welcome dialog on top of it buries the thing the visitor came for. */}
      {loaded && !prefs.onboardingDismissed && !suppressesOnboarding(pathname) ? (
        <Onboarding onDismiss={() => update({ onboardingDismissed: true })} />
      ) : null}
    </div>
  );
}
