import type { LootCategory } from '../items/catalogue.ts';

/**
 * A workstation's sub-method (DESIGN 6c §3h): input and output are goods
 * lists, time is a single scalar. No buildings, no modules, no AL yet.
 */

export type Good = { category: LootCategory; count: number };
export type Container = Partial<Record<LootCategory, number>>;
export type SubMethod = { input: Good[]; output: Good[]; time: number };

/** How many whole batches `hoursWorked` against `method` actually runs, capped by input on hand. */
function batchesOf(container: Container, method: SubMethod, hoursWorked: number): number {
  const byTime = Math.floor(hoursWorked / method.time);
  const byInput = method.input.reduce((max, { category, count }) => Math.min(max, Math.floor((container[category] ?? 0) / count)), Infinity);
  return Math.max(0, Math.min(byTime, byInput));
}

/** Run `method` for `hoursWorked`, deducting input and adding output per whole batch it completes. */
export function runMethod(container: Container, method: SubMethod, hoursWorked: number): { container: Container; batches: number } {
  const batches = batchesOf(container, method, hoursWorked);
  if (batches === 0) return { container, batches };
  const next = { ...container };
  for (const { category, count } of method.input) next[category] = (next[category] ?? 0) - count * batches;
  for (const { category, count } of method.output) next[category] = (next[category] ?? 0) + count * batches;
  return { container: next, batches };
}
