import type { Ability } from '../combat/types.ts';
import type { NodeGrant } from './skilltree.ts';
import type { GraftSpec } from './graft.ts';
import { conditionMet } from './traits.ts';
import type { TraitCondition, TraitContext } from './traits.ts';

/**
 * Signets: the third branch, and the one that can go wrong quietly.
 *
 * A Signet is a top-up on something you already have — a skill node or a trait.
 * It is not bought and not listed. It is gated on a combination of what you
 * carry, what you are, and what has happened, and some of them are found only
 * by stumbling into the right event or reading the right book.
 *
 * This is the retired clue graph coming back. Gates with AND/OR over items,
 * stats, flags and events, and the same failure mode that came with it:
 * PROCEDURALLY GATED PROGRESSION ROUTINELY GENERATES IMPOSSIBLE UPGRADES. The
 * reachability walk below is not a nicety — a Signet whose gate cannot be
 * satisfied is indistinguishable, from inside the game, from one that is merely
 * well hidden. The player would search forever.
 *
 * So the rule enforced here is: a Signet is never offered, hinted at, or
 * counted as content unless it can be PROVEN obtainable from the current world.
 */

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A condition tree.
 *
 * Traits use a flat list because "all of these" covers what a trait needs.
 * Signets need alternatives — two routes to the same power is what makes them
 * feel discovered rather than assigned — so the gate is a real tree.
 */
export type Gate =
  | { kind: 'all'; of: Gate[] }
  | { kind: 'any'; of: Gate[] }
  | { kind: 'condition'; condition: TraitCondition }
  | { kind: 'flag'; flag: string }
  /**
   * Something of a FAMILY, found at or below a depth.
   *
   * A family rather than an exact id because generated ids carry their floor in
   * them — `mat_ashard_7` — so gating on one exact id would mean gating on one
   * exact drop. `family` matches the id prefix: `mat_`, `draught_`, `weapon_`.
   */
  | { kind: 'itemFromDepth'; family: string; minFloor: number };

export const DISCOVERY = ['hinted', 'hidden'] as const;
export type Discovery = (typeof DISCOVERY)[number];

export type Signet = {
  id: string;
  name: string;
  description: string;
  /** What it strengthens: a tree node id, or a trait id. */
  augments: { kind: 'node' | 'trait'; id: string };
  gate: Gate;
  grant: NodeGrant;
  /**
   * Whether the world ever tells you this exists.
   *
   * `hinted` may surface in a book, a rumour or an event. `hidden` never
   * appears until its gate opens — which is why a hidden Signet must never be
   * the only route to anything.
   */
  discovery: Discovery;
  /** Where a hint could be dropped, for the hinted ones. */
  hint?: string;
  /**
   * A branch this Signet grows when it is claimed.
   *
   * A Signet used to top up something you already had. It can now also open
   * somewhere new — which is the difference between an upgrade and a discovery.
   */
  opens?: GraftSpec;
};

/* -------------------------------------------------------------------------- */
/* Evaluating a gate                                                           */
/* -------------------------------------------------------------------------- */

export type GateWorld = {
  flags: Record<string, boolean>;
  /** Floors the player has actually been to. */
  deepestFloor: number;
};

export function gateOpen(gate: Gate, ctx: TraitContext, world: GateWorld): boolean {
  switch (gate.kind) {
    case 'all':
      return gate.of.every((g) => gateOpen(g, ctx, world));
    case 'any':
      return gate.of.some((g) => gateOpen(g, ctx, world));
    case 'condition':
      return conditionMet(gate.condition, ctx);
    case 'flag':
      return world.flags[gate.flag] === true;
    case 'itemFromDepth':
      return ctx.inventory.stacks.some(
        (s) => s.item.id.startsWith(gate.family) && (s.item.foundOn ?? 0) >= gate.minFloor,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Proving a gate can ever open                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the world could in principle supply.
 *
 * Deliberately optimistic: it describes the CEILING of what is reachable, not
 * what the player has. A gate that fails against this can never open no matter
 * how well the player plays, which is exactly the thing worth refusing.
 */
export type Reachable = {
  /** The deepest floor the tower will generate. */
  maxFloor: number;
  /** Item families the tower can drop at all. */
  droppableFamilies: Set<string>;
  /** Flags any event in the world is capable of setting. */
  settableFlags: Set<string>;
  /** The highest a score can be driven by levelling, tree and traits. */
  maxAbility: number;
  maxLevel: number;
  /** Counters that something actually increments. */
  liveCounters: Set<string>;
};

export type Unreachable = { gate: Gate; why: string };

/**
 * Walk a gate and collect every branch that could never be satisfied.
 *
 * An `any` needs only one satisfiable branch to be fine; an `all` needs every
 * one of them. Returning the reasons rather than a boolean is what lets the
 * generator say WHY it discarded a Signet.
 */
export function unsatisfiable(gate: Gate, world: Reachable): Unreachable[] {
  switch (gate.kind) {
    case 'all':
      return gate.of.flatMap((g) => unsatisfiable(g, world));

    case 'any': {
      const failures = gate.of.map((g) => unsatisfiable(g, world));
      // Fine as long as one route through is clear.
      if (failures.some((f) => f.length === 0)) return [];
      return [{ gate, why: 'every alternative is unreachable' }];
    }

    case 'flag':
      return world.settableFlags.has(gate.flag)
        ? []
        : [{ gate, why: `nothing in this world sets the flag "${gate.flag}"` }];

    case 'itemFromDepth': {
      if (!world.droppableFamilies.has(gate.family)) {
        return [{ gate, why: `nothing of the family "${gate.family}" is dropped in this tower` }];
      }
      if (gate.minFloor > world.maxFloor) {
        return [{ gate, why: `floor ${gate.minFloor} is deeper than this tower goes` }];
      }
      return [];
    }

    case 'condition':
      return unsatisfiableCondition(gate, gate.condition, world);
  }
}

function unsatisfiableCondition(gate: Gate, condition: TraitCondition, world: Reachable): Unreachable[] {
  switch (condition.kind) {
    case 'ability':
      return condition.atLeast > world.maxAbility
        ? [{ gate, why: `${condition.ability} cannot be raised to ${condition.atLeast}` }]
        : [];
    case 'level':
      return condition.atLeast > world.maxLevel
        ? [{ gate, why: `level ${condition.atLeast} is beyond this run` }]
        : [];
    case 'counter':
      return world.liveCounters.has(condition.counter)
        ? []
        : [{ gate, why: `nothing increments "${condition.counter}"` }];
    case 'carries':
      return [...world.droppableFamilies].some((f) => condition.item.startsWith(f))
        ? []
        : [{ gate, why: `"${condition.item}" is not obtainable` }];
    case 'personality':
      // Every axis can be driven either way by play, so these are always
      // satisfiable in principle.
      return [];
  }
}

export type Validation = { ok: boolean; problems: Unreachable[] };

export const validateSignet = (signet: Signet, world: Reachable): Validation => {
  const problems = unsatisfiable(signet.gate, world);
  return { ok: problems.length === 0, problems };
};

/**
 * The Signets this world is allowed to contain.
 *
 * Anything that cannot be proven obtainable is DISCARDED rather than shipped
 * and hoped for. A hidden Signet behind a broken gate is the worst possible
 * bug in this system: invisible, permanent, and indistinguishable from
 * intended mystery.
 */
export function admissible(candidates: readonly Signet[], world: Reachable): { kept: Signet[]; discarded: { signet: Signet; problems: Unreachable[] }[] } {
  const kept: Signet[] = [];
  const discarded: { signet: Signet; problems: Unreachable[] }[] = [];

  for (const signet of candidates) {
    const check = validateSignet(signet, world);
    if (check.ok) kept.push(signet);
    else discarded.push({ signet, problems: check.problems });
  }
  return { kept, discarded };
}

/* -------------------------------------------------------------------------- */
/* What the player is allowed to know                                          */
/* -------------------------------------------------------------------------- */

export type SignetView = {
  signet: Signet;
  /** The gate is open and it can be claimed. */
  available: boolean;
  /** Already taken. */
  held: boolean;
};

/**
 * What the panel may show.
 *
 * The same boundary the Writer lives behind: a `hidden` Signet does not appear
 * until its gate opens, and a `hinted` one appears only once the world has
 * actually dropped the hint. Listing everything would turn discovery into a
 * checklist, which is the thing this branch exists to avoid.
 */
export function visibleSignets(
  catalogue: readonly Signet[],
  held: readonly string[],
  ctx: TraitContext,
  world: GateWorld,
): SignetView[] {
  const has = new Set(held);

  return catalogue
    .filter((s) => {
      if (has.has(s.id)) return true;
      const open = gateOpen(s.gate, ctx, world);
      if (open) return true;
      // A hint has to have been dropped in the world before it counts as known.
      return s.discovery === 'hinted' && world.flags[`hint_${s.id}`] === true;
    })
    .map((signet) => ({
      signet,
      available: !has.has(signet.id) && gateOpen(signet.gate, ctx, world),
      held: has.has(signet.id),
    }));
}

export const abilityOf = (grant: NodeGrant): Partial<Record<Ability, number>> => grant.ability ?? {};
