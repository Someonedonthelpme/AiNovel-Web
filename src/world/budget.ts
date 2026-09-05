import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
/**
 * Generation budgets by depth.
 *
 * Floors grow as you climb, but every curve is CAPPED. Without a ceiling, floor
 * 200 would try to generate a continent — slow to make, impossible to keep
 * coherent, and far past what anyone explores in one visit.
 */

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** How many places a region may contain. Grows with depth, capped at 24. */
export function placeBudget(floor: number): { min: number; max: number } {
  const target = clamp(4 + Math.floor(floor / 3), 4, 24);
  return { min: Math.max(3, target - 2), max: target + 2 };
}

/** Named, persistent people. These survive compression, so keep the count sane. */
export function peopleBudget(floor: number): { min: number; max: number } {
  const target = clamp(2 + Math.floor(floor / 6), 2, 10);
  return { min: 1, max: target + 2 };
}

/**
 * Encounter difficulty for the floor. Floor 0 is the safe ground town.
 *
 * `danger === floor` was hardcoded, which meant difficulty could never be
 * decoupled from depth — no quiet story band deep in a tower, no brutal early
 * gauntlet. It is a curve now, and today's numbers are its identity values.
 */
export function dangerFor(floor: number, rules: Ruleset = STANDARD): number {
  return Math.max(0, Math.round(rules.world.dangerBase + floor * rules.world.dangerPerFloor));
}

/**
 * Ground level is always a settlement. Higher floors may be entirely wild, and
 * the deepest ones can hold more than one.
 */
export function settlementBudget(floor: number): { min: number; max: number } {
  if (floor === 0) return { min: 1, max: 1 };
  return { min: 0, max: clamp(1 + Math.floor(floor / 25), 1, 3) };
}
