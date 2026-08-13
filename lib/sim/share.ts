import { findScenario, getScenario } from "./scenarios";
import { rankFor } from "./scoring";
import type { Incident, Rank, ScenarioId, ScoreBreakdown } from "./types";

/**
 * Shareable result links.
 *
 * A finished run is encoded into the URL so it can be shared without a backend,
 * an account, or anything stored server-side.
 *
 * SECURITY / HONESTY NOTE: this is *not* tamper-proof and is not pretending to
 * be. Without a server there is nothing to sign against, so anyone can craft a
 * link claiming a perfect score. That is an acceptable trade for a portfolio
 * demo — but it makes the decoder a genuine untrusted-input boundary, so every
 * field is range-checked and the scenario id is validated against the real
 * catalogue before it reaches `getScenario()` (which throws on unknown ids).
 * Shared results are labelled as unverified in the UI rather than presented as
 * the viewer's own.
 */

/** Bumped if the field order changes, so old links fail cleanly. */
const VERSION = 1;

const SEPARATOR = "~";

export interface SharedResult {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  total: number;
  rank: Rank;
  diagnosisPoints: number;
  speedPoints: number;
  investigationPoints: number;
  remediationPoints: number;
  penalties: number;
  diagnosisAttempts: number;
  evidenceViewedCount: number;
  unnecessaryActionCount: number;
  timeToDiagnosisSeconds: number | null;
  timeToResolutionSeconds: number | null;
}

/** base64url — URL-safe, no padding, so the link survives copy/paste intact. */
function toBase64Url(input: string): string {
  const base64 = typeof btoa === "function" ? btoa(input) : Buffer.from(input).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    return typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** `null` becomes -1 on the wire, since every real duration is >= 0. */
function encodeNullable(value: number | null): number {
  return value === null ? -1 : Math.round(value);
}

function decodeNullable(value: number): number | null {
  return value < 0 ? null : value;
}

export function encodeResult(incident: Incident, score: ScoreBreakdown): string {
  const fields = [
    VERSION,
    incident.scenarioId,
    Math.round(score.total),
    Math.round(score.diagnosisPoints),
    Math.round(score.speedPoints),
    Math.round(score.investigationPoints),
    Math.round(score.remediationPoints),
    Math.round(score.penalties),
    score.diagnosisAttempts,
    score.evidenceViewedCount,
    score.unnecessaryActions.length,
    encodeNullable(score.timeToDiagnosisSeconds),
    encodeNullable(score.timeToResolutionSeconds),
  ];
  return toBase64Url(fields.join(SEPARATOR));
}

/** Reject anything that is not a finite integer inside the expected range. */
function readInt(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Decode a shared result. Returns `null` for anything malformed, out of range,
 * or referencing an unknown scenario — never a partially-populated object.
 */
export function decodeResult(encoded: string | null | undefined): SharedResult | null {
  if (!encoded || typeof encoded !== "string") return null;
  // Guard against absurd input before doing any work.
  if (encoded.length > 512) return null;

  const decoded = fromBase64Url(encoded);
  if (!decoded) return null;

  const parts = decoded.split(SEPARATOR);
  if (parts.length !== 13) return null;

  if (readInt(parts[0], VERSION, VERSION) === null) return null;

  // Validated against the catalogue before getScenario() is ever called.
  const scenario = findScenario(parts[1]);
  if (!scenario) return null;

  const total = readInt(parts[2], 0, 100);
  const diagnosisPoints = readInt(parts[3], 0, 40);
  const speedPoints = readInt(parts[4], 0, 20);
  const investigationPoints = readInt(parts[5], 0, 15);
  const remediationPoints = readInt(parts[6], 0, 25);
  const penalties = readInt(parts[7], 0, 30);
  const diagnosisAttempts = readInt(parts[8], 0, 20);
  const evidenceViewedCount = readInt(parts[9], 0, 50);
  const unnecessaryActionCount = readInt(parts[10], 0, 20);
  // One simulated day is a generous ceiling for any run.
  const timeToDiagnosis = readInt(parts[11], -1, 86_400);
  const timeToResolution = readInt(parts[12], -1, 86_400);

  const required = [
    total,
    diagnosisPoints,
    speedPoints,
    investigationPoints,
    remediationPoints,
    penalties,
    diagnosisAttempts,
    evidenceViewedCount,
    unnecessaryActionCount,
    timeToDiagnosis,
    timeToResolution,
  ];
  if (required.some((value) => value === null)) return null;

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    total: total!,
    // Derived rather than transmitted, so the badge can never disagree with the
    // number beside it.
    rank: rankFor(total!),
    diagnosisPoints: diagnosisPoints!,
    speedPoints: speedPoints!,
    investigationPoints: investigationPoints!,
    remediationPoints: remediationPoints!,
    penalties: penalties!,
    diagnosisAttempts: diagnosisAttempts!,
    evidenceViewedCount: evidenceViewedCount!,
    unnecessaryActionCount: unnecessaryActionCount!,
    timeToDiagnosisSeconds: decodeNullable(timeToDiagnosis!),
    timeToResolutionSeconds: decodeNullable(timeToResolution!),
  };
}

/** Absolute URL for a finished run, for the clipboard. */
export function buildShareUrl(incident: Incident, score: ScoreBreakdown, origin: string): string {
  return `${origin}/result?r=${encodeResult(incident, score)}`;
}

/** The scenario behind a shared result, for the "try it yourself" prompt. */
export function scenarioForShared(result: SharedResult) {
  return getScenario(result.scenarioId);
}
