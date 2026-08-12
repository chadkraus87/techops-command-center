import { hexId, noiseAt, pick } from "./random";
import type { ScenarioTicketTemplate, SupportTicket, TicketPriority } from "./types";

/**
 * Support ticket generation.
 *
 * Tickets are the *customer's* view of an incident, and they lag it. Real users
 * do not file a ticket the instant a service degrades — they retry, they wait,
 * they ask a colleague, and only then do they write in. The delay and the
 * ramping arrival rate below are what make the support queue feel authentic
 * rather than like another metric stream.
 */

export const MAX_TICKETS = 80;

const CUSTOMERS = [
  { name: "Alicia Moreau", company: "Northwind Retail" },
  { name: "Ben Tanaka", company: "Fielding Logistics" },
  { name: "Chloé Dubois", company: "Aster Health" },
  { name: "Dev Patel", company: "Kestrel Analytics" },
  { name: "Emma Lindqvist", company: "Vantage Media" },
  { name: "Farid Haddad", company: "Orbit Studios" },
  { name: "Grace Okafor", company: "Cedar & Co" },
  { name: "Hugo Ramírez", company: "Lumen Works" },
  { name: "Ines Kovač", company: "Braid Financial" },
  { name: "Jonas Weber", company: "Trailhead Outdoors" },
  { name: "Keiko Yamada", company: "Sable Design" },
  { name: "Liam O'Connell", company: "Harbour Freight Co" },
  { name: "Maya Sørensen", company: "Pinnacle Labs" },
  { name: "Noah Adeyemi", company: "Rivet Software" },
  { name: "Priya Nair", company: "Solstice Travel" },
  { name: "Quinn Barlow", company: "Ironwood Group" },
];

const ENVIRONMENTS = [
  "Chrome 141 / macOS 15.2",
  "Safari 18.3 / iOS 18.3",
  "Firefox 139 / Windows 11",
  "Chrome 141 / Windows 11",
  "Edge 141 / Windows 11",
  "Chrome 140 / Ubuntu 24.04",
  "API client / curl 8.9.1",
];

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export function priorityLabel(priority: TicketPriority): string {
  return PRIORITY_LABEL[priority];
}

let ticketCounter = 4820;

/**
 * Tickets per tick, as a function of how bad things are and how long they have
 * been bad. The `delay` term means nothing arrives for the first ~35 seconds of
 * an incident, then volume builds.
 */
export function ticketRateForTick(intensity: number, elapsedSeconds: number): number {
  if (intensity <= 0.12) return 0.004; // the occasional unrelated ticket
  const awareness = Math.min(1, Math.max(0, (elapsedSeconds - 35) / 90));
  return intensity * awareness * 0.28;
}

export interface TicketGenerationInput {
  tick: number;
  clock: number;
  intensity: number;
  elapsedSeconds: number;
  templates: ScenarioTicketTemplate[];
  incidentId?: string;
}

/** Generate zero or more tickets for this tick. Deterministic. */
export function generateTickets(input: TicketGenerationInput): SupportTicket[] {
  const { tick, clock, intensity, elapsedSeconds, templates, incidentId } = input;
  const rate = ticketRateForTick(intensity, elapsedSeconds);
  if (rate <= 0 || templates.length === 0) return [];

  // Fractional rates become a probability; rates above 1 produce several.
  const whole = Math.floor(rate);
  const remainder = rate - whole;
  const count = whole + (noiseAt(`ticket:roll`, tick) < remainder ? 1 : 0);
  if (count <= 0) return [];

  const tickets: SupportTicket[] = [];
  for (let i = 0; i < count; i++) {
    const seed = `ticket:${tick}:${i}`;
    const template = pick(templates, `${seed}:tpl`, tick);
    const customer = pick(CUSTOMERS, `${seed}:cust`, tick);
    tickets.push({
      id: `TKT-${ticketCounter++}`,
      customer: customer.name,
      company: customer.company,
      subject: template.subject,
      body: template.body,
      priority: template.priority,
      status: "new",
      createdAt: clock,
      affectedService: template.affectedService,
      incidentId,
      environment: pick(ENVIRONMENTS, `${seed}:env`, tick),
      suggestedSteps: template.suggestedSteps,
      internalNotes:
        incidentId !== undefined
          ? [`Auto-linked to ${incidentId} by symptom correlation.`]
          : ["No active incident matched — triage individually."],
    });
  }
  return tickets;
}

/** A small backlog of ordinary, unrelated tickets so the queue is never empty. */
export function seedTickets(clock: number): SupportTicket[] {
  const seeds: Array<{
    subject: string;
    body: string;
    priority: TicketPriority;
    service: SupportTicket["affectedService"];
    status: SupportTicket["status"];
    ageMinutes: number;
    steps: string[];
  }> = [
    {
      subject: "How do I add a second billing contact?",
      body: "We need invoices to go to our finance mailbox as well as mine. I can't find the setting.",
      priority: "low",
      service: "payment-service",
      status: "open",
      ageMinutes: 182,
      steps: ["Point the customer to Settings → Billing → Contacts", "Confirm the invoice email was updated"],
    },
    {
      subject: "API rate limit seems lower than documented",
      body: "Docs say 1000 requests/minute but we're getting 429s around 850. Are burst limits different?",
      priority: "normal",
      service: "api-gateway",
      status: "open",
      ageMinutes: 96,
      steps: ["Check the tenant's configured rate limit tier", "Explain burst vs sustained limits"],
    },
    {
      subject: "Export produces empty CSV for one project",
      body: "Exports work for all our projects except Atlas, which downloads a file with only headers.",
      priority: "normal",
      service: "customer-api",
      status: "pending",
      ageMinutes: 240,
      steps: ["Reproduce with the tenant id", "Check for a date-range filter excluding all rows"],
    },
    {
      subject: "Two-factor codes arriving late",
      body: "My SMS codes turn up two or three minutes after I request them, by which point they've expired.",
      priority: "high",
      service: "notification-worker",
      status: "open",
      ageMinutes: 51,
      steps: ["Check notification queue depth", "Consider recommending an authenticator app"],
    },
    {
      subject: "Request: webhook for project deletion",
      body: "We'd like to be notified when a project is deleted so we can clean up on our side.",
      priority: "low",
      service: "internal-api",
      status: "open",
      ageMinutes: 320,
      steps: ["Log as a feature request", "Link to the existing webhook roadmap item"],
    },
    {
      subject: "Thumbnail orientation wrong for portrait photos",
      body: "Portrait images from iPhone come out rotated 90 degrees in the thumbnail but fine at full size.",
      priority: "normal",
      service: "media-service",
      status: "resolved",
      ageMinutes: 410,
      steps: ["Known EXIF orientation bug — fixed in v3.14.1", "Confirm the customer sees corrected thumbnails"],
    },
  ];

  return seeds.map((seed, index) => {
    const customer = CUSTOMERS[index % CUSTOMERS.length];
    return {
      id: `TKT-${4800 + index}`,
      customer: customer.name,
      company: customer.company,
      subject: seed.subject,
      body: seed.body,
      priority: seed.priority,
      status: seed.status,
      createdAt: clock - seed.ageMinutes * 60_000,
      affectedService: seed.service,
      environment: ENVIRONMENTS[index % ENVIRONMENTS.length],
      suggestedSteps: seed.steps,
      internalNotes: ["Routine ticket — not linked to an incident."],
    } satisfies SupportTicket;
  });
}

/** Reset the id counter. Used by the environment reset and by tests. */
export function resetTicketCounter(): void {
  ticketCounter = 4820;
}

export function ticketIdSuffix(seed: string, tick: number): string {
  return hexId(seed, tick, 4);
}
