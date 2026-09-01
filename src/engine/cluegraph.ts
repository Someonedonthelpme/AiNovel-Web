import type { Beat, Clue, ClueId, Gate, NpcId } from './types.ts';
import { TRUST_MAX } from './types.ts';

/** Runtime view: is this gate satisfied right now? */
export type PlayContext = {
  playerFacts: ReadonlySet<ClueId>;
  trustOf: (npc: NpcId) => number;
  flags: Readonly<Record<string, boolean>>;
};

export function isOpen(gate: Gate, ctx: PlayContext): boolean {
  switch (gate.kind) {
    case 'open':
      return true;
    case 'trust':
      return ctx.trustOf(gate.npc) >= gate.min;
    case 'hasClue':
      return ctx.playerFacts.has(gate.clue);
    case 'flag':
      return ctx.flags[gate.flag] === true;
    case 'allOf':
      return gate.of.every((g) => isOpen(g, ctx));
    case 'anyOf':
      return gate.of.some((g) => isOpen(g, ctx));
  }
}

/** Worldgen view: could this gate EVER be satisfied, given what's reachable so far? */
export function isSatisfiable(
  gate: Gate,
  reachable: ReadonlySet<ClueId>,
  npcExists: (id: NpcId) => boolean,
): boolean {
  switch (gate.kind) {
    case 'open':
      return true;
    case 'trust':
      // Trust is raisable to TRUST_MAX, so the only hard blocker is a missing NPC
      // or a threshold nobody could ever reach.
      return npcExists(gate.npc) && gate.min <= TRUST_MAX;
    case 'hasClue':
      return reachable.has(gate.clue);
    case 'flag':
      // Flags are set by Director deltas at runtime, so they cannot be proven
      // reachable statically. Treated as satisfiable; the validator reports them
      // separately so the hole in the guarantee stays visible.
      return true;
    case 'allOf':
      return gate.of.every((g) => isSatisfiable(g, reachable, npcExists));
    case 'anyOf':
      return gate.of.some((g) => isSatisfiable(g, reachable, npcExists));
  }
}

/** Every flag a gate depends on — these are the unproven edges. */
export function flagsIn(gate: Gate): string[] {
  switch (gate.kind) {
    case 'flag':
      return [gate.flag];
    case 'allOf':
    case 'anyOf':
      return gate.of.flatMap(flagsIn);
    default:
      return [];
  }
}

export type Reachability = {
  reachable: Set<ClueId>;
  /** Iteration at which each clue first became reachable — its depth in the graph. */
  depth: Map<ClueId, number>;
  unreachable: ClueId[];
};

/**
 * Fixpoint walk over the clue graph.
 *
 * Start from nothing, repeatedly admit every clue whose gate is satisfiable given
 * what is already admitted, until nothing new is admitted. Cycles simply never
 * get admitted, which is the correct answer for a cycle.
 */
export function walkReachable(
  clues: readonly Clue[],
  holderValid: (c: Clue) => boolean,
  npcExists: (id: NpcId) => boolean,
): Reachability {
  const reachable = new Set<ClueId>();
  const depth = new Map<ClueId, number>();
  let iteration = 0;

  for (;;) {
    // Each pass is evaluated against a SNAPSHOT of the previous pass. Admitting
    // within a pass would let a clue see a sibling admitted moments earlier,
    // collapsing every depth to 0 whenever the array happens to be in dependency
    // order — and depth is what orders the beats.
    const frontier = new Set(reachable);
    const admitted: ClueId[] = [];
    for (const clue of clues) {
      if (frontier.has(clue.id)) continue;
      if (!holderValid(clue)) continue;
      if (!isSatisfiable(clue.gate, frontier, npcExists)) continue;
      admitted.push(clue.id);
    }
    if (admitted.length === 0) break;
    for (const id of admitted) {
      reachable.add(id);
      depth.set(id, iteration);
    }
    iteration++;
  }

  return {
    reachable,
    depth,
    unreachable: clues.filter((c) => !reachable.has(c.id)).map((c) => c.id),
  };
}

/**
 * Beats are DERIVED from the validated graph, never generated separately.
 *
 * Ordering the solution clues by graph depth means every beat is reachable by
 * construction and the exit conditions can never deadlock.
 */
export function deriveBeats(
  solutionRequires: readonly ClueId[],
  depth: Map<ClueId, number>,
  pressureFor: (clue: ClueId) => string[],
  leash = 3,
): Beat[] {
  return [...solutionRequires]
    .sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || a.localeCompare(b))
    .map((clue, i) => ({
      id: `b${i + 1}`,
      exitWhen: clue,
      leash,
      pressure: pressureFor(clue),
    }));
}
