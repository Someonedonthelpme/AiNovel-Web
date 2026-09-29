import type { LootCategory } from '../items/catalogue.ts';
import type { Ability } from '../combat/types.ts';
import type { Need, Needs } from '../character/persona.ts';
import { NEED_MAX } from '../character/persona.ts';

/**
 * A workstation's sub-method (DESIGN 6c §3h): input and output are goods
 * lists, time is a single scalar. No buildings, no modules, no AL yet.
 */

export type Good = { category: LootCategory; count: number };
export type Container = Partial<Record<LootCategory, number>>;
export type SubMethod = { input: Good[]; output: Good[]; time: number };

/** A `service` workstation's method (DESIGN 6c §3h): no input, no capacity — it drains time and raises a Need instead of a Good. */
export type NeedOutput = { need: Need; amount: number };
export type ServiceMethod = { output: NeedOutput[]; time: number };

export const WORKSTATION_SUBKINDS = ['economic', 'service', 'administrative'] as const;
export type WorkstationSubkind = (typeof WORKSTATION_SUBKINDS)[number];
export type Workstation = { id?: string; subkind: WorkstationSubkind; method?: SubMethod; serviceMethod?: ServiceMethod };

export type Building = { id?: string; tier: number; container: Container; workstations?: Workstation[] };

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

/** Run the workstation `workstationId`'s own method against `building`, its hours scaled by `efficiency`. Null if it isn't there, or has none to run. */
export function runWorkstation(building: Building, workstationId: string, hoursWorked: number, efficiency = 1): { container: Container; batches: number } | null {
  const method = building.workstations?.find((w) => w.id === workstationId)?.method;
  return method ? runAt(building, method, hoursWorked * efficiency) : null;
}

/**
 * The runner off-class penalty (DESIGN 6c §3c): full on-class; off-class judged
 * on the named class's stat, worse if the runner's own class doesn't use that
 * stat at all — "worst to best."
 */
export type ClassFit = 'on-class' | 'shares-stat' | 'raw-stat';

// ponytail: placeholder curve — exact magnitudes wait on no-rebalance-until-feature-complete;
// only the ORDERING (on-class > shares-stat > raw-stat, both scaling with the stat) is decided.
export function efficiencyOf(fit: ClassFit, stat: number, statRange: readonly [number, number]): number {
  if (fit === 'on-class') return 1;
  const scaled = Math.max(0, Math.min(1, (stat - statRange[0]) / (statRange[1] - statRange[0])));
  return fit === 'shares-stat' ? 0.5 + 0.4 * scaled : 0.2 + 0.3 * scaled;
}

export type LifeClass = { id: string; stat: Ability };

/** DESIGN 6c §3j: the stat an economic workstation's runner is judged on, keyed off its primary output good — not the building or the trade name. */
const STAT_FOR_LOOT_CATEGORY: Record<LootCategory, Ability> = {
  weapon: 'str', material: 'str',
  armour: 'con', draught: 'con',
  rations: 'vit', seed: 'vit',
  pack: 'dex', tool: 'dex',
  part: 'int', book: 'int',
  ingredient: 'wis',
};

export function statFor(method: SubMethod): Ability {
  return STAT_FOR_LOOT_CATEGORY[method.output[0].category];
}

/** DESIGN 6c §3j: same life class is on-class; a different one sharing the runner's stat is shares-stat; anything else is raw-stat. */
export function classFitOf(worker: LifeClass, runner: LifeClass): ClassFit {
  if (worker.id === runner.id) return 'on-class';
  return worker.stat === runner.stat ? 'shares-stat' : 'raw-stat';
}

/** DESIGN 6c §3j: the stat a service workstation's runner is judged on, keyed off its primary output Need. */
const STAT_FOR_NEED: Record<Need, Ability> = {
  rest: 'vit', safety: 'str', food: 'cha', company: 'cha', purpose: 'wis',
};

export function statForService(method: ServiceMethod): Ability {
  return STAT_FOR_NEED[method.output[0].need];
}

/** Run a service `method` for `hoursWorked`, raising `needs` by whole batches, clamped at NEED_MAX. No container, no input. */
export function runService(needs: Needs, method: ServiceMethod, hoursWorked: number): Needs {
  const batches = Math.floor(hoursWorked / method.time);
  if (batches <= 0) return needs;
  const next = { ...needs };
  for (const { need, amount } of method.output) next[need] = Math.max(0, Math.min(NEED_MAX, next[need] + amount * batches));
  return next;
}
