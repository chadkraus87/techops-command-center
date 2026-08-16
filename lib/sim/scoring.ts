import { getScenario } from "./scenarios";
import type { Incident, Rank, ScoreBreakdown } from "./types";

/**
 * Incident scoring.
 *
 * The weighting is deliberate and reflects what actually matters in an incident
 * review: getting the cause right (40) counts for more than getting it fast
 * (20); investigating before acting is rewarded (15); and acting on systems that
 * were never at fault is penalised, because in production that is how a SEV-3
 * becomes a SEV-1.
 */

const MAX_DIAGNOSIS = 40;
const MAX_SPEED = 20;
const MAX_INVESTIGATION = 15;
const MAX_REMEDIATION = 25;

/** Points for the diagnosis, decaying with each wrong answer. */
export function diagnosisPoints(attempts: string[], correctId: string): number {
  const index = attempts.indexOf(correctId);
  if (index === -1) return 0;
  switch (index) {
    case 0:
      return MAX_DIAGNOSIS;
    case 1:
      return 26;
    case 2:
      return 15;
    default:
      return 8;
  }
}

/**
 * Points for time to diagnosis. Full marks inside the scenario's "fast" window,
 * decaying linearly to zero at four times that.
 */
export function speedPoints(seconds: number | null, targetSeconds: number): number {
  if (seconds === null) return 0;
  if (seconds <= targetSeconds) return MAX_SPEED;
  const ceiling = targetSeconds * 4;
  if (seconds >= ceiling) return 0;
  return Math.round(MAX_SPEED * (1 - (seconds - targetSeconds) / (ceiling - targetSeconds)));
}

/** Points for gathering evidence before committing to an answer. */
export function investigationPoints(evidenceCount: number): number {
  // Five distinct pieces of evidence is a thorough investigation.
  return Math.min(MAX_INVESTIGATION, Math.round((evidenceCount / 5) * MAX_INVESTIGATION));
}

/** Points for remediation: full marks only for a clean, minimal fix. */
export function remediationPoints(actionsTaken: string[], requiredIds: string[]): number {
  const applied = requiredIds.filter((id) => actionsTaken.includes(id));
  if (applied.length === 0) return 0;
  const completion = applied.length / requiredIds.length;
  return Math.round(MAX_REMEDIATION * completion);
}

/** Each action taken that was not required costs points. */
export function penaltyFor(unnecessaryActions: string[]): number {
  return Math.min(30, unnecessaryActions.length * 8);
}

/**
 * Coerce a possibly-tampered count to a sane non-negative integer.
 *
 * Investigation state can arrive from restored sessionStorage, which is
 * user-editable. Without this, a hand-edited value propagates straight through
 * the arithmetic and renders as "NaN/100".
 */
function safeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Hints cost points, and deliberately less than a wrong guess.
 *
 * The intent is that asking for help is always better than flailing: three
 * hints cost 12, while two wrong diagnoses plus a needless restart costs 22.
 * Guidance should feel like a legitimate choice, not a walk of shame.
 */
export function hintPenaltyFor(hintsRevealed: number): number {
  return safeCount(hintsRevealed) * 4;
}

export function rankFor(score: number): Rank {
  if (score >= 95) return "Site Reliability Expert";
  if (score >= 85) return "Incident Commander";
  if (score >= 72) return "Senior Troubleshooter";
  if (score >= 58) return "Systems Analyst";
  if (score >= 40) return "Support Specialist";
  return "Junior Technician";
}

export const RANKS: Rank[] = [
  "Junior Technician",
  "Support Specialist",
  "Systems Analyst",
  "Senior Troubleshooter",
  "Incident Commander",
  "Site Reliability Expert",
];

/** Score a completed (or abandoned) incident. */
export function scoreIncident(incident: Incident): ScoreBreakdown {
  const scenario = getScenario(incident.scenarioId);
  const { investigation } = incident;

  const timeToDiagnosisSeconds =
    investigation.diagnosedAt !== null
      ? Math.round((investigation.diagnosedAt - incident.startedAt) / 1000)
      : null;
  const timeToResolutionSeconds =
    incident.resolvedAt !== null ? Math.round((incident.resolvedAt - incident.startedAt) / 1000) : null;

  // A "fast" diagnosis is roughly the time it takes the incident to fully
  // declare itself — you cannot reasonably be faster than the symptoms.
  const targetSeconds = Math.max(45, scenario.declareAfterSeconds);

  const diagnosis = diagnosisPoints(investigation.diagnosisAttempts, scenario.correctDiagnosisId);
  const speed = speedPoints(timeToDiagnosisSeconds, targetSeconds);
  const investigationScore = investigationPoints(investigation.evidenceViewed.length);
  const remediation = remediationPoints(investigation.actionsTaken, scenario.requiredRemediationIds);

  const unnecessaryActions = investigation.actionsTaken.filter(
    (id) => !scenario.requiredRemediationIds.includes(id),
  );
  const hintPenalty = hintPenaltyFor(investigation.hintsRevealed);
  const penalties = penaltyFor(unnecessaryActions) + hintPenalty;

  const total = Math.max(
    0,
    Math.min(100, diagnosis + speed + investigationScore + remediation - penalties),
  );

  return {
    diagnosisPoints: diagnosis,
    speedPoints: speed,
    investigationPoints: investigationScore,
    remediationPoints: remediation,
    penalties,
    total,
    rank: rankFor(total),
    timeToDiagnosisSeconds,
    timeToResolutionSeconds,
    diagnosisAttempts: investigation.diagnosisAttempts.length,
    unnecessaryActions,
    evidenceViewedCount: investigation.evidenceViewed.length,
    hintsRevealed: safeCount(investigation.hintsRevealed),
    hintPenalty,
  };
}

/** Human-readable label for the resolved unnecessary action ids. */
export function labelForAction(incident: Incident, actionId: string): string {
  const scenario = getScenario(incident.scenarioId);
  return scenario.remediationOptions.find((o) => o.id === actionId)?.label ?? actionId;
}
