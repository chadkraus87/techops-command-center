import type { Scenario, ScenarioId } from "../types";
import { cdnOutage } from "./cdn-outage";
import { databaseOverload } from "./database-overload";
import { dnsFailure } from "./dns-failure";
import { memoryLeak } from "./memory-leak";
import { packetLoss } from "./packet-loss";
import { paymentProviderOutage } from "./payment-provider-outage";
import { redisFailure } from "./redis-failure";
import { tlsExpiry } from "./tls-expiry";

/**
 * The scenario catalogue.
 *
 * Adding an incident to the product means adding one file here and one entry to
 * this list — the engine, the UI, the scoring and the network tools all read
 * from the `Scenario` shape and need no changes.
 */
export const SCENARIOS: Scenario[] = [
  dnsFailure,
  databaseOverload,
  memoryLeak,
  redisFailure,
  cdnOutage,
  tlsExpiry,
  packetLoss,
  paymentProviderOutage,
];

const SCENARIO_MAP = new Map<ScenarioId, Scenario>(SCENARIOS.map((s) => [s.id, s]));

export function getScenario(id: ScenarioId): Scenario {
  const scenario = SCENARIO_MAP.get(id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}

export function findScenario(id: string): Scenario | undefined {
  return SCENARIO_MAP.get(id as ScenarioId);
}

export {
  cdnOutage,
  databaseOverload,
  dnsFailure,
  memoryLeak,
  packetLoss,
  paymentProviderOutage,
  redisFailure,
  tlsExpiry,
};
