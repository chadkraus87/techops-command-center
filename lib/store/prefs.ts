"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Rank, ScenarioId, StoredResult } from "@/lib/sim/types";

/**
 * Local preferences and results.
 *
 * Everything here lives in the browser only — there is no account, no server and
 * nothing to sign in to.
 *
 * localStorage is an external store, so it is read through `useSyncExternalStore`
 * rather than an effect. That gives the correct server snapshot for free (no
 * hydration mismatch), keeps every consumer of the hook in sync when one of them
 * writes, and avoids the cascading render an effect-then-setState would cause.
 */

const STORAGE_KEY = "techops.prefs.v1";

export interface Preferences {
  onboardingDismissed: boolean;
  soundEnabled: boolean;
  reducedChrome: boolean;
  /** Guided mode: surfaces progressive hints during an investigation. */
  guidedMode: boolean;
  results: StoredResult[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  onboardingDismissed: false,
  soundEnabled: false,
  reducedChrome: false,
  // Off by default: an experienced visitor should not be handed the answer.
  guidedMode: false,
  results: [],
};

/**
 * The snapshot carries its own `loaded` flag.
 *
 * This is load-bearing, not cosmetic. `useSyncExternalStore` compares snapshots
 * by reference: if the client snapshot were also `DEFAULT_PREFERENCES`, React
 * would see no change after hydration and never re-render — so anything gated on
 * "have we read storage yet?" (the onboarding dialog) would never appear. Making
 * the client snapshot a distinct object with `loaded: true` guarantees exactly
 * one re-render once storage has actually been read.
 */
export interface PreferencesSnapshot extends Preferences {
  /** False during SSR and the hydration render; true once storage was read. */
  loaded: boolean;
}

const SERVER_SNAPSHOT: PreferencesSnapshot = { ...DEFAULT_PREFERENCES, loaded: false };

let cache: PreferencesSnapshot = SERVER_SNAPSHOT;
let initialised = false;

const listeners = new Set<() => void>();

/**
 * Stored results are rendered back into the interface, so each entry is
 * validated field by field rather than trusted. Storage is user-editable by
 * definition; anything malformed is dropped instead of being displayed.
 */
function isStoredResult(value: unknown): value is StoredResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<StoredResult>;
  return (
    typeof r.scenarioId === "string" &&
    typeof r.rank === "string" &&
    typeof r.score === "number" &&
    Number.isFinite(r.score) &&
    r.score >= 0 &&
    r.score <= 100 &&
    typeof r.completedAt === "number" &&
    Number.isFinite(r.completedAt) &&
    (r.timeToResolutionSeconds === null ||
      (typeof r.timeToResolutionSeconds === "number" &&
        Number.isFinite(r.timeToResolutionSeconds)))
  );
}

function parse(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      onboardingDismissed: parsed.onboardingDismissed === true,
      soundEnabled: parsed.soundEnabled === true,
      reducedChrome: parsed.reducedChrome === true,
      guidedMode: parsed.guidedMode === true,
      results: Array.isArray(parsed.results) ? parsed.results.filter(isStoredResult) : [],
    };
  } catch {
    // Corrupt storage should never break the application.
    return DEFAULT_PREFERENCES;
  }
}

function getSnapshot(): PreferencesSnapshot {
  if (!initialised) {
    initialised = true;
    let stored: Preferences;
    try {
      stored = parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private browsing or storage disabled — fall back to defaults.
      stored = DEFAULT_PREFERENCES;
    }
    cache = { ...stored, loaded: true };
  }
  return cache;
}

/** The server has no storage, so it always renders the defaults. */
function getServerSnapshot(): PreferencesSnapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Keep multiple tabs consistent with each other.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = { ...parse(event.newValue), loaded: true };
    listeners.forEach((l) => l());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: Preferences): void {
  cache = { ...next, loaded: true };
  initialised = true;
  try {
    // `loaded` is transient render state, not a preference — never persist it.
    const { onboardingDismissed, soundEnabled, reducedChrome, guidedMode, results } = next;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ onboardingDismissed, soundEnabled, reducedChrome, guidedMode, results }),
    );
  } catch {
    // Quota or private browsing — the value still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

export function usePreferences() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback((patch: Partial<Preferences>) => {
    write({ ...getSnapshot(), ...patch });
  }, []);

  const recordResult = useCallback((result: StoredResult) => {
    const current = getSnapshot();
    // Keep only the personal best per scenario.
    const previousBest = current.results.find((r) => r.scenarioId === result.scenarioId);
    if (previousBest && previousBest.score >= result.score) return;

    write({
      ...current,
      results: [
        ...current.results.filter((r) => r.scenarioId !== result.scenarioId),
        result,
      ].slice(-24),
    });
  }, []);

  const clearResults = useCallback(() => {
    write({ ...getSnapshot(), results: [] });
  }, []);

  return {
    prefs,
    /** True once storage has actually been read, so the UI can avoid a flash. */
    loaded: prefs.loaded,
    update,
    recordResult,
    clearResults,
  };
}

export function bestFor(results: StoredResult[], scenarioId: ScenarioId): StoredResult | undefined {
  return results.filter((r) => r.scenarioId === scenarioId).sort((a, b) => b.score - a.score)[0];
}

export function highestRank(results: StoredResult[]): Rank | null {
  if (results.length === 0) return null;
  return results.reduce((best, r) => (r.score > best.score ? r : best)).rank;
}
