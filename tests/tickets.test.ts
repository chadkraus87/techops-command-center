import { describe, expect, it } from "vitest";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { generateTickets, meridianTriageHref, MERIDIAN_TRIAGE_URL } from "@/lib/sim/tickets";

describe("scenario tickets and the Meridian Triage link", () => {
  const dns = SCENARIOS.find((s) => s.id === "dns-failure")!;

  // A busy incident a few minutes in, so several tickets arrive.
  const tickets = Array.from({ length: 200 }, (_, tick) =>
    generateTickets({
      tick,
      clock: 1_000 * tick,
      intensity: 1,
      elapsedSeconds: 300,
      templates: dns.ticketTemplates,
      incidentId: "INC-1",
      scenarioId: dns.id,
    }),
  ).flat();

  it("records which template produced each ticket", () => {
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.source?.scenarioId).toBe("dns-failure");
      expect(dns.ticketTemplates[t.source!.templateIndex].subject).toBe(t.subject);
    }
  });

  it("links to the recorded triage with a 1-based template number", () => {
    expect(meridianTriageHref({ scenarioId: "dns-failure", templateIndex: 0 })).toBe(`${MERIDIAN_TRIAGE_URL}/techops/dns-failure/1`);
  });

  it("leaves background tickets without a source", () => {
    const background = generateTickets({ tick: 1, clock: 0, intensity: 1, elapsedSeconds: 300, templates: dns.ticketTemplates });
    for (const t of background) expect(t.source).toBeUndefined();
  });
});
