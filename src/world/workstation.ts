import type { LootCategory } from '../items/catalogue.ts';

/**
 * A workstation's sub-method (DESIGN 6c §3h): input and output are goods
 * lists, time is a single scalar. No buildings, no modules, no AL yet.
 */

export type Good = { category: LootCategory; count: number };
export type Container = Partial<Record<LootCategory, number>>;
export type SubMethod = { input: Good[]; output: Good[]; time: number };
export type Building = { id?: string; tier: number; container: Container };

const sumOf = (goods: Good[]): number => goods.reduce((s, { count }) => s + count, 0);
const totalOf = (container: Container): number => Object.values(container).reduce((s: number, n) => s + (n ?? 0), 0);

/** How many whole batches `hoursWorked` against `method` actually runs, capped by input, time and space. */
function batchesOf(container: Container, method: SubMethod, hoursWorked: number, capacity: number): number {
  const byTime = Math.floor(hoursWorked / method.time);
  const byInput = method.input.reduce((max, { category, count }) => Math.min(max, Math.floor((container[category] ?? 0) / count)), Infinity);
  const netPerBatch = sumOf(method.output) - sumOf(method.input);
  const bySpace = netPerBatch <= 0 ? Infinity : Math.max(0, Math.floor((capacity - totalOf(container)) / netPerBatch));
  return Math.max(0, Math.min(byTime, byInput, bySpace));
}

/** Run `method` for `hoursWorked`, deducting input and adding output per whole batch it completes. */
export function runMethod(container: Container, method: SubMethod, hoursWorked: number, capacity = Infinity): { container: Container; batches: number } {
  const batches = batchesOf(container, method, hoursWorked, capacity);
  if (batches === 0) return { container, batches };
  const next = { ...container };
  for (const { category, count } of method.input) next[category] = (next[category] ?? 0) - count * batches;
  for (const { category, count } of method.output) next[category] = (next[category] ?? 0) + count * batches;
  return { container: next, batches };
}

/** A building's container capacity, derived from its tier — never stored (DESIGN 6c §3g/§3d rule 3). */
// ponytail: flat placeholder (tier * 20); real numbers wait on the no-rebalance-until-feature-complete rule.
export function capacityOf(tier: number): number {
  return tier * 20;
}

/** Run `method` against `building`'s own container, capped by its tier-derived capacity. */
export function runAt(building: Building, method: SubMethod, hoursWorked: number): { container: Container; batches: number } {
  return runMethod(building.container, method, hoursWorked, capacityOf(building.tier));
}
