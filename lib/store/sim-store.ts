"use client";

import { create } from "zustand";
import {
  abortScenario,
  acknowledgeAlert,
  applyRemediation,
  createInitialState,
  endScenario,
  recordEvidence,
  resetEnvironment,
  startScenario,
  submitDiagnosis,
  tick as engineTick,
  triggerDeployment,
} from "@/lib/sim/engine";
import { clearSession, loadSession, saveSession } from "./persistence";
import type { ScenarioId, ServiceId, SimSpeed, SimState } from "@/lib/sim/types";

/**
 * The simulation store.
 *
 * The engine is pure and owns *what* happens; this store owns *when* it happens.
 * Keeping the clock here means the entire simulation can be driven forward in a
 * test by calling `tick` directly, with no timers involved.
 *
 * The clock starts at a fixed simulated epoch rather than `Date.now()`. That is
 * a deliberate choice: it removes any server/client hydration mismatch, and it
 * makes the demo reproducible — the same actions always produce the same
 * timestamps.
 */
export const SIM_EPOCH = Date.UTC(2026, 7, 11, 14, 2, 0);

export interface ToastMessage {
  id: string;
  title: string;
  detail?: string;
  severity: "critical" | "warning" | "info" | "success";
}

interface SimStore {
  state: SimState;
  toasts: ToastMessage[];
  /** Set while the environment is being rebuilt, so the UI can show skeletons. */
  resetting: boolean;
  /**
   * False until the session-restore attempt has run. Saving is blocked until
   * then — otherwise the fresh initial state would overwrite the snapshot we
   * are about to restore from.
   */
  hydrated: boolean;

  /** Restore a saved session, if there is one. Safe to call more than once. */
  hydrate: () => void;
  /** Persist the current state. Throttled by the caller. */
  persist: () => void;

  tick: (dtSeconds?: number) => void;
  setSpeed: (speed: SimSpeed) => void;
  togglePause: () => void;
  setRunning: (running: boolean) => void;

  triggerScenario: (scenarioId: ScenarioId) => void;
  diagnose: (optionId: string) => { correct: boolean; feedback: string };
  remediate: (actionId: string) => { accepted: boolean; message: string };
  noteEvidence: (evidenceId: string) => void;
  acknowledge: (alertId: string) => void;
  clearScenario: () => void;
  /** Abandon an incident in progress and return the environment to baseline. */
  abortIncident: () => void;
  deploy: (serviceId: ServiceId, shouldFail: boolean) => void;
  reset: () => void;

  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

/** Toasts are capped so a storm of alerts cannot bury the interface. */
const MAX_TOASTS = 4;

export const useSimStore = create<SimStore>((set, get) => ({
  state: createInitialState(SIM_EPOCH),
  toasts: [],
  resetting: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    // Restore first, then mark hydrated — the ordering is what prevents the
    // fresh initial state from being persisted over a real saved session.
    const restored = loadSession(get().state);
    if (restored) {
      set({ state: restored, hydrated: true });
      const incident = restored.incidents.find((i) => i.status !== "resolved");
      set((s) => ({
        toasts: [
          ...s.toasts,
          {
            id: `toast-${toastCounter++}`,
            title: "Session resumed",
            detail: incident
              ? `${incident.id} is still open — picking up where you left off.`
              : "Restored the environment from before the reload.",
            severity: "info" as const,
          },
        ],
      }));
    } else {
      set({ hydrated: true });
    }
  },

  persist: () => {
    if (!get().hydrated) return;
    saveSession(get().state);
  },

  tick: (dtSeconds = 1) => {
    const { state } = get();
    if (!state.running) return;

    const result = engineTick(state, dtSeconds);
    set({ state: result.state });

    if (result.notifications.length === 0) return;

    /**
     * Coalesce alert storms. A SEV-1 can fire eight alerts within a few
     * seconds; eight separate toasts would bury the interface at exactly the
     * moment the operator needs to see it. Non-alert events (recovery,
     * resolution) always surface individually because they are rare and
     * meaningful.
     */
    const alerts = result.notifications.filter((n) => n.kind === "alert");
    const others = result.notifications.filter((n) => n.kind !== "alert");

    if (alerts.length === 1) {
      get().pushToast({ title: alerts[0].message, severity: alerts[0].severity });
    } else if (alerts.length > 1) {
      const critical = alerts.filter((a) => a.severity === "critical").length;
      get().pushToast({
        title: `${alerts.length} alerts fired`,
        detail: critical > 0 ? `${critical} critical · ${alerts[0].message}` : alerts[0].message,
        severity: critical > 0 ? "critical" : "warning",
      });
    }

    for (const notification of others) {
      get().pushToast({ title: notification.message, severity: notification.severity });
    }
  },

  setSpeed: (speed) => set((s) => ({ state: { ...s.state, speed } })),

  togglePause: () => set((s) => ({ state: { ...s.state, running: !s.state.running } })),

  setRunning: (running) => set((s) => ({ state: { ...s.state, running } })),

  triggerScenario: (scenarioId) => {
    set((s) => ({ state: startScenario(s.state, scenarioId) }));
    get().pushToast({
      title: "Incident simulation started",
      detail: "Telemetry is beginning to change across the environment.",
      severity: "critical",
    });
  },

  diagnose: (optionId) => {
    const result = submitDiagnosis(get().state, optionId);
    set({ state: result.state });
    get().pushToast({
      title: result.correct ? "Diagnosis confirmed" : "Diagnosis ruled out",
      detail: result.correct ? "Root cause identified." : "Keep investigating.",
      severity: result.correct ? "success" : "warning",
    });
    return { correct: result.correct, feedback: result.feedback };
  },

  remediate: (actionId) => {
    const result = applyRemediation(get().state, actionId);
    set({ state: result.state });
    if (result.accepted) {
      get().pushToast({ title: "Remediation started", detail: result.message, severity: "info" });
    }
    return { accepted: result.accepted, message: result.message };
  },

  noteEvidence: (evidenceId) => set((s) => ({ state: recordEvidence(s.state, evidenceId) })),

  acknowledge: (alertId) => set((s) => ({ state: acknowledgeAlert(s.state, alertId) })),

  clearScenario: () => set((s) => ({ state: endScenario(s.state) })),

  abortIncident: () => {
    if (!get().state.active) return;
    set((s) => ({ state: abortScenario(s.state) }));
    get().persist();
    get().pushToast({
      title: "Incident cleared",
      detail: "Services are back at baseline. The run was recorded as abandoned.",
      severity: "success",
    });
  },

  deploy: (serviceId, shouldFail) => {
    set((s) => ({ state: triggerDeployment(s.state, serviceId, shouldFail) }));
    get().pushToast({
      title: "Deployment started",
      detail: shouldFail
        ? "Release is rolling out. Watch the metrics."
        : "Release rolled out successfully.",
      severity: shouldFail ? "warning" : "success",
    });
  },

  reset: () => {
    set({ resetting: true });
    // Drop the saved session too, or the next reload would resurrect the very
    // environment the user just asked to throw away.
    clearSession();
    set({ state: resetEnvironment(SIM_EPOCH), toasts: [], hydrated: true });
    // A brief pause makes the reset legible rather than instantaneous.
    setTimeout(() => set({ resetting: false }), 450);
  },

  pushToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: `toast-${toastCounter++}` }].slice(-MAX_TOASTS),
    })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ---------------------------------------------------------------------------
// Selectors — kept here so components subscribe to the narrowest slice possible
// and a one-second tick does not re-render the whole application.
// ---------------------------------------------------------------------------

export const selectServices = (s: SimStore) => s.state.services;
export const selectClock = (s: SimStore) => s.state.clock;
export const selectActive = (s: SimStore) => s.state.active;
export const selectIncidents = (s: SimStore) => s.state.incidents;
export const selectAlerts = (s: SimStore) => s.state.alerts;
export const selectLogs = (s: SimStore) => s.state.logs;
export const selectTickets = (s: SimStore) => s.state.tickets;
export const selectRunning = (s: SimStore) => s.state.running;
export const selectSpeed = (s: SimStore) => s.state.speed;
export const selectHistory = (s: SimStore) => s.state.history;
export const selectGlobalHistory = (s: SimStore) => s.state.globalHistory;
export const selectDeployments = (s: SimStore) => s.state.deployments;

export const useService = (id: ServiceId) => useSimStore((s) => s.state.services[id]);
