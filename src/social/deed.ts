import { adopt, certaintyOf, firsthand, retell } from '../character/belief.ts';
import type { Belief, Claim } from '../character/belief.ts';
import { EDGE_AXES, nudgeAll, reachedBy, regardedBy } from './edge.ts';
import type { EdgeAxis, Edges } from './edge.ts';

/**
 * What you did, who saw it, and how far it got.
 *
 * The chain the design keeps calling for and nothing has ever run: a deed is
 * not a paragraph. Somebody does something, the people standing there SEE it,
 * what they saw TRAVELS, and where it travels the place thinks less of you.
 *
 * THREE THINGS MAKE IT WORK, and each was missing.
 *
 * WITNESSES. Who was standing there. Free — a place already lists its people —
 * and nothing has ever asked.
 *
 * PROPAGATION ALONG THE SOCIAL GRAPH, not the map. It spreads through people
 * who know each other, so it follows the story rather than the geography, and
 * it is BOUNDED BY DEGREES OF SEPARATION rather than by a headcount. Nobody has
 * to be evicted to make room; the chain simply runs out. Each hop goes through
 * `retell`, so a deed loses certainty, then its source, and eventually can come
 * back inverted — which is what makes hearing your own deed return to you wrong
 * the most memorable thing this system produces.
 *
 * REPUTATION. `Gazetteer.reputation` has existed, defaulted to nought and been
 * written by nobody for the whole life of the codebase. This is its writer.
 *
 * ONE MECHANISM, and deliberately: rules, rumours and deeds are the same
 * object travelling the same graph. Only the `Claim` differs.
 */

/**
 * The things somebody can be seen to do.
 *
 * Closed, like every vocabulary the engine resolves. A deed exists here only
 * once something EMITS it — `helped` and `stole` are not listed, because no
 * turn can currently produce either, and a deed nothing emits is a row in a
 * table pretending to be a mechanic.
 */
export const DEEDS = [
  'helped', 'insulted', 'humiliated', 'threatened', 'drewOn', 'killed', 'spared',
] as const;
export type DeedKind = (typeof DEEDS)[number];

/**
 * The deeds the DIRECTOR may name, which is deliberately a subset.
 *
 * The model says WHICH; the mark below says how much — the same division as
 * `useItem`, where the model names the draught and the item decides what
 * drinking it does. That is what lets a model judge "they did that man a real
 * service", which no rule can see, without ever touching a number.
 *
 * `drewOn`, `killed` and `spared` are NOT here. They are combat outcomes the
 * engine resolves itself, and a model able to claim one could report a killing
 * that never happened.
 */
/**
 * The deeds that outlive their era (DESIGN 6c era E4): done on an era floor, they
 * are told on the era floors above it. Chosen by the engine, like the marks — an
 * insult is local, a life taken or saved is history.
 */
export const ECHOING = ['helped', 'killed', 'spared'] as const satisfies readonly DeedKind[];

/** A deed remembered by later eras, kept as it was seen: names, not ids, since it is history. */
export type Echo = { floor: number; kind: DeedKind; whom?: string; where: string };

export const DIRECTOR_DEEDS = ['helped', 'insulted', 'humiliated', 'threatened'] as const;
export type DirectorDeed = (typeof DIRECTOR_DEEDS)[number];

export const isDirectorDeed = (kind: string): kind is DirectorDeed =>
  (DIRECTOR_DEEDS as readonly string[]).includes(kind);

export type Deed = {
  kind: DeedKind;
  /** Who did it. */
  doer: string;
  /** Who it was done to, or for. Absent when it was done to nobody in particular. */
  toward?: string;
  /** Where, so the place's standing can move. */
  at: string;
};

type Mark = {
  /** How it reads to somebody who saw it. */
  onWitness: Partial<Record<EdgeAxis, number>>;
  /** How it reads to the person it was done to, or for. */
  onToward: Partial<Record<EdgeAxis, number>>;
  /** What the doer carries away from it, toward the person they did it to. */
  onDoer: Partial<Record<EdgeAxis, number>>;
  /** What it does to how a place regards you. Negative is notoriety. */
  standing: number;
};

/**
 * What each deed costs, from three sides at once.
 *
 * The victim and the witness do not feel the same thing about the same act,
 * and neither feels what the doer does — which is the whole reason edges are
 * directional. Being threatened is frightening; watching somebody be threatened
 * is chilling in a different way.
 *
 * `onDoer` is where `guilt` finally has a writer. It only bites where there was
 * something to spoil: harming a stranger costs you nothing, and `guiltFor`
 * scales it by what you thought of them.
 */
const MARKS: Record<DeedKind, Mark> = {
  /**
   * A real service, and the writer `obligation` was waiting for.
   *
   * Only a model can see this one. No rule can tell the difference between
   * handing somebody a rope and handing them a rock, and the engine sees
   * neither — which is precisely why the Director is allowed to name it.
   */
  helped: {
    onWitness: { regard: 1, trust: 1 },
    onToward: { trust: 2, regard: 1, obligation: 2 },
    onDoer: {},
    standing: 1,
  },
  insulted: {
    onWitness: { regard: -1 },
    onToward: { trust: -1, resentment: 1, respect: -1 },
    onDoer: { guilt: 1 },
    standing: -1,
  },
  /** Not merely rude: done deliberately, and in front of people. */
  humiliated: {
    onWitness: { regard: -2, fear: 1 },
    onToward: { trust: -2, respect: -2, resentment: 3 },
    onDoer: { guilt: 2 },
    standing: -2,
  },
  threatened: {
    onWitness: { fear: 1, regard: -1 },
    onToward: { trust: -2, fear: 2, resentment: 1 },
    onDoer: { guilt: 1 },
    standing: -2,
  },
  drewOn: {
    onWitness: { fear: 2, regard: -1 },
    onToward: { trust: -2, fear: 2, resentment: 2 },
    onDoer: { guilt: 2 },
    standing: -2,
  },
  killed: {
    onWitness: { fear: 3, regard: -2, trust: -1 },
    onToward: {},
    onDoer: { guilt: 3 },
    standing: -3,
  },
  /** The one that reads well. Letting somebody live is seen, and remembered. */
  spared: {
    onWitness: { regard: 2, trust: 1 },
    onToward: { trust: 2, respect: 2, obligation: 2 },
    onDoer: {},
    standing: 2,
  },
};

export const markOf = (kind: DeedKind): Mark => MARKS[kind];

/* -------------------------------------------------------------------------- */
/* Who saw it                                                                  */
/* -------------------------------------------------------------------------- */

/** Everybody standing there when it happened, except whoever did it. */
export const witnessesOf = (present: readonly string[], deed: Deed): string[] =>
  present.filter((id) => id !== deed.doer);

export const claimOf = (deed: Deed): Claim =>
  ({ kind: 'deed', who: deed.doer, what: deed.toward ? `${deed.kind}:${deed.toward}` : deed.kind });

/* -------------------------------------------------------------------------- */
/* How far it got                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Who comes to hold it, and how the story looks by the time it reaches them.
 *
 * A breadth-first walk out from the witnesses along the edges — people who know
 * each other, in both directions, because being told something does not require
 * you to like the teller. `depth` is the degrees of separation the world
 * permits; ZERO IS THE IDENTITY VALUE and means a deed reaches the people who
 * saw it and stops there.
 *
 * Deterministic: the frontier is sorted, so a replay produces the same set of
 * knowers with the same confidence in the same order.
 */
export function spreadOf(
  edges: Edges | undefined,
  deed: Deed,
  witnesses: readonly string[],
  depth: number,
): Map<string, Belief> {
  const held = new Map<string, Belief>();
  const claim = claimOf(deed);

  // What you saw yourself you hold outright, with no source to doubt.
  for (const who of witnesses) held.set(who, firsthand(claim));

  let frontier = [...witnesses].sort();
  for (let hop = 0; hop < Math.max(0, depth); hop++) {
    const next: string[] = [];

    for (const teller of frontier) {
      const belief = held.get(teller);
      if (!belief) continue;
      const told = retell(belief, teller);

      // Everyone this person has any dealing with, either way round.
      const listeners = [...new Set([...reachedBy(edges, teller), ...regardedBy(edges, teller)])].sort();
      for (const listener of listeners) {
        if (listener === deed.doer || held.has(listener)) continue;
        held.set(listener, told);
        next.push(listener);
      }
    }

    if (next.length === 0) break;
    frontier = next.sort();
  }

  return held;
}

/* -------------------------------------------------------------------------- */
/* What it costs                                                               */
/* -------------------------------------------------------------------------- */

/** Scale a mark by how sure somebody is of it. Hearsay moves less than sight. */
const weighted = (
  mark: Partial<Record<EdgeAxis, number>>,
  confidence: number,
): Partial<Record<EdgeAxis, number>> => {
  const out: Partial<Record<EdgeAxis, number>> = {};
  for (const axis of EDGE_AXES) {
    const value = mark[axis];
    if (value === undefined) continue;
    const scaled = Math.round(value * confidence);
    if (scaled !== 0) out[axis] = scaled;
  }
  return out;
};

/**
 * Guilt is only ever proportional to what you spoiled.
 *
 * Harming a stranger costs you nothing you would notice; harming somebody you
 * thought well of is the thing that sits with you. Reading it off the doer's
 * OWN edge is what makes this a consequence of the relationship rather than a
 * flat tax on violence.
 */
export const guiltFor = (regardHeld: number, base: number): number =>
  (regardHeld > 0 ? Math.min(base, regardHeld) : 0);

export type Aftermath = {
  edges: Edges;
  /** Everybody who ended up holding it, and how sure they are. */
  knowers: Map<string, Belief>;
  /** What it did to the standing of the place it happened in. */
  standing: number;
};

/**
 * Everything one deed does, in one pass.
 *
 * Pure, and called from the FOLD — a consequence that lived only in the live
 * loop would vanish on reload, which is the trap drift, the fight and the lossy
 * snapshot each fell into in turn.
 */
export function witnessDeed(
  edges: Edges | undefined,
  deed: Deed,
  present: readonly string[],
  depth: number,
): Aftermath {
  const mark = MARKS[deed.kind];
  const witnesses = witnessesOf(present, deed);
  const knowers = spreadOf(edges, deed, witnesses, depth);

  let next = edges ?? {};
  let reach = 0;

  for (const [who, belief] of knowers) {
    // The person it was done TO feels it as the victim, not as an onlooker,
    // however they came to know — though only somebody who was there is sure.
    const felt = who === deed.toward ? mark.onToward : mark.onWitness;
    next = nudgeAll(next, who, deed.doer, weighted(felt, belief.confidence));
    reach += belief.confidence;
  }

  // And what the doer carries away, scaled by what they thought of the victim.
  if (deed.toward && mark.onDoer.guilt) {
    const regardHeld = next[`${deed.doer}>${deed.toward}`]?.axes.regard ?? 0;
    const guilt = guiltFor(regardHeld, mark.onDoer.guilt);
    if (guilt > 0) next = nudgeAll(next, deed.doer, deed.toward, { guilt });
  }

  // Guarded rather than multiplied through: `-1 * 0` is NEGATIVE zero, which
  // is equal to nought everywhere except `Object.is` — and that is what strict
  // assertions use.
  return { edges: next, knowers, standing: reach === 0 ? 0 : Math.round(mark.standing * reach) };
}

/**
 * What somebody holds about another person, said plainly.
 *
 * The READER for `Person.beliefs`, which deeds write and nothing has consulted.
 * Phrased as BELIEF and never as fact — "she is fairly sure you threatened the
 * smith" — because the whole point of a belief is that it can be wrong, and a
 * Writer told the truth instead would give the game away in the prose.
 */
export function beliefsAbout(held: readonly Belief[] | undefined, who: string, named: (id: string) => string): string[] {
  const out: string[] = [];
  for (const belief of held ?? []) {
    if (belief.claim.kind !== 'deed' || belief.claim.who !== who) continue;

    const [kind, toward] = belief.claim.what.split(':');
    if (!(DEEDS as readonly string[]).includes(kind)) continue;

    const at = toward ? ` ${named(toward)}` : '';
    const not = belief.holds ? '' : 'does NOT think ';
    out.push(`${not}${named(who)} ${kind}${at} — ${certaintyOf(belief)}`);
  }
  return out;
}

/** Fold a deed's beliefs into one person's, leaving anybody else's alone. */
export const beliefsAfter = (held: readonly Belief[] | undefined, learned: Belief | undefined): Belief[] | undefined =>
  learned ? adopt(held ?? [], learned) : held ? [...held] : undefined;
