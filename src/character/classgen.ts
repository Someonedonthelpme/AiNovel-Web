import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { Ability } from '../combat/types.ts';
import { ROLES } from './roles.ts';
import type { Role } from './roles.ts';

/**
 * Generating classes and their subclasses.
 *
 * The last authored catalogue, and the one that needed the most care: a class
 * is the thing a player CHOOSES cold at creation, so an incoherent one is not a
 * curiosity found in play but a card they have to bet a run on.
 *
 * Split the way everything else here is split. `roles.ts` fixes the SHAPE —
 * a front-liner is str or con, d10 or d12, core from the disciplines that stand
 * and take it, shut out of the figure-arts. This file draws inside that shape:
 * which disciplines exactly, which abilities, how many doors out, and where
 * each door goes. `classnames.ts` then asks the model for the words, given the
 * world the player just described, so a front-liner comes back a knight in a
 * kingdom and a harbour guard on a drowned coast.
 *
 * SUBCLASSES OFFER TWO ROUTES, and that is the real improvement over the
 * authored sixteen. Every one of those was a crossing — a door into somewhere
 * the class was shut out of — which made level three a choice of WHICH door
 * rather than a choice at all. A class now grows both kinds:
 *
 *   cross   a door out, into a discipline the class is shut out of
 *   deepen  more of what it already is, on a discipline it was built on
 *
 * So the level three decision is specialise or broaden, which is a decision
 * about the character rather than about the map.
 */

export type SubclassRoute = 'deepen' | 'cross';

/** The mechanical half of a class, before anything is named. */
export type ClassShape = {
  id: string;
  role: string;
  /** The brief handed to the model, so it can name this in the world's terms. */
  brief: string;
  hitDie: 6 | 8 | 10 | 12;
  primary: Ability;
  secondary: Ability;
  /** Stats it leans on, and away from. A price on a path's gate, not a lock. */
  favours: Ability[];
  against: Ability[];
  startingArmour: number | null;
  /** The weapon shape it sets out with. The model names it. */
  weapon: { sides: number; range: number; type: string };
  subclasses: SubclassShape[];
};

export type SubclassShape = {
  id: string;
  route: SubclassRoute;
  /** The stat its island belongs to. */
  opens: Ability;
  /** What the granted skill is composed against. */
  grant: { kind: 'combat' | 'utility' | 'social'; budget: number };
};

/* -------------------------------------------------------------------------- */
/* Drawing one                                                                 */
/* -------------------------------------------------------------------------- */

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/** Draw `count` distinct entries, in a stable order. */
function draw<T>(rng: Rng, from: readonly T[], count: number): T[] {
  const pool = [...from].sort(() => rng() - 0.5);
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * How many disciplines a class may be shut out of.
 *
 * Bounded at both ends, and neither bound is cosmetic. Too few and there is
 * nowhere for a crossing subclass to cross TO. Too many and `disciplinesFor`
 * runs out of anything to build a tree from — the subset it draws is up to
 * `MAX_DISCIPLINES`, so what is left has to cover that with room to spare.
 */
export const MIN_FORBIDDEN = 2;
export const MAX_FORBIDDEN = 4;

/** Weapon shapes, so a d12 front-liner is not handed a dagger. */
const WEAPONS: Record<string, { sides: number; range: number; type: string }[]> = {
  str: [{ sides: 10, range: 1, type: 'slashing' }, { sides: 8, range: 1, type: 'bludgeoning' }],
  dex: [{ sides: 6, range: 1, type: 'piercing' }, { sides: 8, range: 6, type: 'piercing' }],
  con: [{ sides: 8, range: 1, type: 'bludgeoning' }, { sides: 10, range: 1, type: 'slashing' }],
  int: [{ sides: 4, range: 1, type: 'piercing' }, { sides: 6, range: 4, type: 'piercing' }],
  wis: [{ sides: 6, range: 1, type: 'bludgeoning' }, { sides: 6, range: 6, type: 'piercing' }],
  cha: [{ sides: 6, range: 1, type: 'piercing' }, { sides: 4, range: 1, type: 'slashing' }],
};

/**
 * The budget a subclass grant is composed against.
 *
 * Chosen against the authored sixteen, which price 4.0 to 13.0 with a median
 * of 7.5 — so a generated grant should land in the same country rather than
 * being the best thing in the game or an apology.
 *
 * Measured rather than guessed, and raised once: a 7-12 budget came out at
 * 2.5 to 10.0, median 6.0, with the floor well under the cheapest authored
 * grant — `composeSkill` does not spend everything it is given, so the budget
 * has to sit above the price you want back.
 */
export const SUBCLASS_BUDGET = { low: 9, high: 15 };

function shapeFrom(rng: Rng, role: Role, index: number): ClassShape {
  const [primary, secondary] = pick(rng, role.abilities);
  const favours = draw(rng, role.favoursFrom, 2);

  /*
   * A stat can be leant on or leant away from, never both. Mapping the old
   * discipline lists across mechanically produced exactly that contradiction —
   * a scholar who favoured INT and resisted it — and a generator resolves such
   * a thing silently and wrongly.
   */
  const leaning = new Set<Ability>(favours);
  const against = draw(rng, role.againstFrom.filter((a) => !leaning.has(a)), 2);

  const id = `cls_${role.id}_${index}`;

  /*
   * Both routes, always. A class that could only cross would make level three
   * a choice of which door; one that could only deepen would make the tree's
   * locked disciplines permanently locked. Two of each, so the decision is
   * specialise-or-broaden and then which flavour of it.
   */
  const crossings = draw(rng, against, Math.min(2, against.length));
  const deepenings = draw(rng, favours, Math.min(2, favours.length));

  const subclasses: SubclassShape[] = [
    ...crossings.map((opens, i) => ({
      id: `sub_${id}_cross_${i}`,
      route: 'cross' as const,
      opens,
      grant: {
        kind: pick(rng, ['combat', 'combat', 'utility'] as const),
        budget: SUBCLASS_BUDGET.low + rng() * (SUBCLASS_BUDGET.high - SUBCLASS_BUDGET.low),
      },
    })),
    ...deepenings.map((opens, i) => ({
      id: `sub_${id}_deepen_${i}`,
      route: 'deepen' as const,
      opens,
      grant: {
        kind: pick(rng, ['combat', 'combat', 'social'] as const),
        budget: SUBCLASS_BUDGET.low + rng() * (SUBCLASS_BUDGET.high - SUBCLASS_BUDGET.low),
      },
    })),
  ];

  return {
    id,
    role: role.id,
    brief: role.brief,
    hitDie: pick(rng, role.dice),
    primary,
    secondary,
    favours,
    against,
    startingArmour: pick(rng, role.armour),
    weapon: pick(rng, WEAPONS[primary]),
    subclasses,
  };
}

/* -------------------------------------------------------------------------- */
/* A world's roster                                                            */
/* -------------------------------------------------------------------------- */

export const MIN_CLASSES = 6;
export const MAX_CLASSES = 8;

/**
 * The mechanical shapes this world offers, before the model names them.
 *
 * Roles are DEALT rather than drawn, so a world uses every kind of person it
 * has before offering a second of any one — the same fix the Signet themes
 * needed after two identical Signets of the Ledger Hand turned up in one
 * tower. Where a role does repeat, the second draws different disciplines and
 * different abilities, which makes it a genuinely different class rather than
 * the same one twice.
 */
export function classShapesFor(seed: number, count?: number): ClassShape[] {
  const rng = mulberry32((seed ^ 0xc1a55) >>> 0);
  const want = count ?? MIN_CLASSES + Math.floor(rng() * (MAX_CLASSES - MIN_CLASSES + 1));

  const deck = [...ROLES].sort(() => rng() - 0.5);
  const shapes: ClassShape[] = [];

  for (let i = 0; i < want; i++) {
    shapes.push(shapeFrom(rng, deck[i % deck.length], i));
  }

  return shapes;
}

/* -------------------------------------------------------------------------- */
/* Checking one                                                                */
/* -------------------------------------------------------------------------- */

export type ShapeProblem = { shape: string; why: string };

/**
 * Everything that must be true of a class for the tree to be buildable.
 *
 * The proof, and it earns its keep the same way `admissible` does for Signets:
 * a class whose forbidden list overlapped its core would generate a tree with
 * a discipline that is both always and never present, and nothing downstream
 * would report it — the player would just have a tree that made no sense.
 */
export function checkShape(shape: ClassShape, _unused = 0): ShapeProblem[] {
  const problems: ShapeProblem[] = [];
  const say = (why: string) => problems.push({ shape: shape.id, why });

  const favours = new Set(shape.favours);
  const against = new Set(shape.against);

  if (favours.size === 0) say('leans on nothing, so it is not a kind of person');
  if (against.size === 0) say('leans away from nothing, so it has nowhere to cross to');
  for (const a of against) {
    if (favours.has(a)) say(`"${a}" is both leant on and leant away from`);
  }

  const crossings = shape.subclasses.filter((s) => s.route === 'cross');
  const deepenings = shape.subclasses.filter((s) => s.route === 'deepen');
  if (crossings.length === 0) say('offers no way across');
  if (deepenings.length === 0) say('offers no way deeper');

  for (const sub of crossings) {
    if (!against.has(sub.opens)) say(`crossing "${sub.id}" opens "${sub.opens}", which it does not lean away from`);
  }
  for (const sub of deepenings) {
    if (!favours.has(sub.opens)) say(`deepening "${sub.id}" opens "${sub.opens}", which it does not lean on`);
  }

  const opened = shape.subclasses.map((s) => s.opens);
  if (new Set(opened).size !== opened.length) say('points two subclasses at the same door');

  return problems;
}
