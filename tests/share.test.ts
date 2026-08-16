import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeResult, encodeResult } from "@/lib/sim/share";
import { scoreIncident } from "@/lib/sim/scoring";
import type { Incident, ScoreBreakdown } from "@/lib/sim/types";

/**
 * Shared result links.
 *
 * The decoder is an untrusted-input boundary — anyone can hand-edit a URL — so
 * most of these tests are about what it *refuses* rather than what it accepts.
 */

const EPOCH = Date.UTC(2026, 7, 11, 14, 2, 0);

function incidentFixture(overrides: Partial<Incident["investigation"]> = {}): Incident {
  return {
    id: "INC-1042",
    scenarioId: "dns-failure",
    title: "DNS Resolution Failure",
    severity: "SEV-1",
    status: "resolved",
    startedAt: EPOCH,
    resolvedAt: EPOCH + 180_000,
    affectedServices: [],
    customerImpact: "",
    timeline: [],
    rootCause: "",
    resolution: "",
    investigation: {
      diagnosisAttempts: ["dns-failure"],
      diagnosedAt: EPOCH + 40_000,
      correctDiagnosis: true,
      actionsTaken: ["restore-dns-zone", "flush-resolver-cache"],
      evidenceViewed: ["a", "b", "c"],
      remainingSteps: [],
      hintsRevealed: 0,
      ...overrides,
    },
  };
}

/** Round-trip a fixture through encode → decode. */
function roundTrip(incident: Incident) {
  const score = scoreIncident(incident);
  return { score, decoded: decodeResult(encodeResult(incident, score)) };
}

describe("encoding a result", () => {
  it("round-trips every scored field", () => {
    const incident = incidentFixture();
    const { score, decoded } = roundTrip(incident);

    expect(decoded).not.toBeNull();
    expect(decoded!.scenarioId).toBe("dns-failure");
    expect(decoded!.scenarioTitle).toBe("DNS Resolution Failure");
    expect(decoded!.total).toBe(score.total);
    expect(decoded!.diagnosisPoints).toBe(score.diagnosisPoints);
    expect(decoded!.speedPoints).toBe(score.speedPoints);
    expect(decoded!.investigationPoints).toBe(score.investigationPoints);
    expect(decoded!.remediationPoints).toBe(score.remediationPoints);
    expect(decoded!.penalties).toBe(score.penalties);
    expect(decoded!.diagnosisAttempts).toBe(score.diagnosisAttempts);
    expect(decoded!.timeToResolutionSeconds).toBe(score.timeToResolutionSeconds);
  });

  it("derives the rank from the score rather than trusting the link", () => {
    const { score, decoded } = roundTrip(incidentFixture());
    expect(decoded!.rank).toBe(score.rank);
  });

  it("preserves a null time-to-diagnosis for an unsolved run", () => {
    const incident = incidentFixture({ diagnosisAttempts: [], diagnosedAt: null, correctDiagnosis: false });
    const { decoded } = roundTrip(incident);
    expect(decoded!.timeToDiagnosisSeconds).toBeNull();
  });

  it("produces a URL-safe token", () => {
    const incident = incidentFixture();
    const token = encodeResult(incident, scoreIncident(incident));
    // base64url only: no +, / or = to be mangled in transit.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("builds an absolute share URL", () => {
    const incident = incidentFixture();
    const url = buildShareUrl(incident, scoreIncident(incident), "https://example.test");
    expect(url.startsWith("https://example.test/result?r=")).toBe(true);
  });

  it("is stable — the same run always yields the same link", () => {
    const incident = incidentFixture();
    const score = scoreIncident(incident);
    expect(encodeResult(incident, score)).toBe(encodeResult(incident, score));
  });

  it("round-trips every scenario in the catalogue", () => {
    for (const scenarioId of [
      "dns-failure",
      "database-overload",
      "memory-leak",
      "redis-failure",
      "cdn-outage",
      "tls-expiry",
      "packet-loss",
      "payment-provider-outage",
    ] as const) {
      const incident = { ...incidentFixture(), scenarioId };
      const { decoded } = roundTrip(incident);
      expect(decoded?.scenarioId).toBe(scenarioId);
    }
  });
});

describe("rejecting bad input", () => {
  const rejected = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["not base64", "!!!not-base64!!!"],
    ["random text", "aGVsbG8gd29ybGQ"],
    ["too few fields", btoa("1~dns-failure~90")],
    ["too many fields", btoa(Array(20).fill("1").join("~"))],
  ] as const;

  for (const [name, input] of rejected) {
    it(`rejects ${name}`, () => {
      expect(decodeResult(input as string | null | undefined)).toBeNull();
    });
  }

  it("rejects an unknown scenario id rather than throwing", () => {
    // getScenario() throws on unknown ids, so validation must catch this first.
    const forged = btoa("1~../../etc/passwd~100~40~20~15~25~0~1~5~0~40~120");
    expect(() => decodeResult(forged)).not.toThrow();
    expect(decodeResult(forged)).toBeNull();
  });

  it("rejects a score above the maximum", () => {
    expect(decodeResult(btoa("1~dns-failure~9999~40~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects negative scores", () => {
    expect(decodeResult(btoa("1~dns-failure~-50~40~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects a component above its own ceiling", () => {
    // Diagnosis is worth at most 40 points.
    expect(decodeResult(btoa("1~dns-failure~90~999~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects non-numeric fields", () => {
    expect(decodeResult(btoa("1~dns-failure~ninety~40~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects non-integer fields", () => {
    expect(decodeResult(btoa("1~dns-failure~90.5~40~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects an unknown schema version", () => {
    expect(decodeResult(btoa("99~dns-failure~90~40~20~15~25~0~1~5~0~40~120"))).toBeNull();
  });

  it("rejects an absurdly long token without doing the work", () => {
    expect(decodeResult("A".repeat(5000))).toBeNull();
  });

  it("rejects an implausible duration", () => {
    // More than a simulated day.
    expect(decodeResult(btoa("1~dns-failure~90~40~20~15~25~0~1~5~0~40~999999"))).toBeNull();
  });

  it("accepts a hand-crafted but valid link", () => {
    // Tampering is possible by design — the UI labels shared results unverified.
    const decoded = decodeResult(btoa("1~dns-failure~100~40~20~15~25~0~1~5~0~30~90"));
    expect(decoded).not.toBeNull();
    expect(decoded!.total).toBe(100);
    expect(decoded!.rank).toBe("Site Reliability Expert");
  });
});

describe("score integrity", () => {
  it("never reports a rank that disagrees with its score", () => {
    // Even a forged link gets a rank derived from the number shown beside it.
    const forged = decodeResult(btoa("1~dns-failure~10~0~0~0~0~0~1~0~0~-1~-1"));
    expect(forged!.rank).toBe("Junior Technician");
  });

  it("handles a zero-score run", () => {
    const incident = incidentFixture({
      diagnosisAttempts: [],
      diagnosedAt: null,
      correctDiagnosis: false,
      actionsTaken: [],
      evidenceViewed: [],
      remainingSteps: ["restore-dns-zone"],
    });
    const score: ScoreBreakdown = scoreIncident(incident);
    expect(score.total).toBe(0);
    const decoded = decodeResult(encodeResult(incident, score));
    expect(decoded!.total).toBe(0);
  });
});
