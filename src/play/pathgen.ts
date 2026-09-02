import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';

/**
 * Paths: what replaced disciplines.
 *
 * A discipline was a hardcoded fantasy category — `magic`, `blackMagic`,
 * `flame` — and it was the last such thing in a game that generates its world,
 * its people, its traits, its Signets and its classes. It broke the moment
 * somebody described a tower standing among rusted freeways: we would generate
 * a Data Sifter carrying a Signal Rifle and then hand them a skill tree made of
 * spellcraft.
 *
 * A PATH IS A NAME OVER A STAT PAIR. The code decides the stats, which decides
 * everything mechanical — the grammar comes from `statgrammar`, so what a path
 * can DO follows from what it runs on. The model decides the words, given the
 * world the player described. Two worlds get the same mechanics under different
 * names, which is exactly what a setting-agnostic system should look like:
 *
 *   fantasy   Swordwork STR · Figures INT · Field Craft WIS
 *   sci-fi    Breaching STR · Cybernetics INT · Recon WIS
 *
 * AND A STAT SPREAD DECIDES WHICH ARE OPEN. That replaces `core` / `affinity` /
 * `forbidden`, and is strictly more dynamic than a class was: a class is fixed
 * at creation and a spread is not, so raising INT mid-run genuinely unseals the
 * figure-path to somebody who started as a brawler.
 */

export type PathShape = {
  id: string;
  /** What it runs on. The primary supplies the grammar. */
  primary: Ability;
  secondary: Ability;
  /**
   * What it takes to unseal it.
   *
   * Always on the PRIMARY, so the thing you must raise is the thing the path
   * is about — a gate on the secondary would ask you to invest in one stat to
   * reach skills built out of another.
   */
  needs: number;
  /** Handed to the model so it can name this in the world's terms. */
  brief: string;
};

/**
 * The window a gate can sit in.
 *
 * Point buy runs 8-15 and a typical spread carries three or four scores at 13
 * or better, so gating in this band opens three or four paths at creation and
 * leaves the rest as visible goals. Both ends matter: below the floor a path
 * would be free to everybody, and above the ceiling one could be unreachable
 * for a whole run.
 */
export const MIN_GATE = 10;
export const MAX_GATE = 15;

export const MIN_PATHS = 10;
export const MAX_PATHS = 12;

/** How the model is told what a stat MEANS, so it can name a path for it. */
export const STAT_BRIEF: Record<Ability, string> = {
  str: 'forcing things open and hitting hard up close',
  dex: 'precision, and hitting what you aimed at from anywhere',
  con: 'holding on, shrugging things off, and outlasting them',
  agi: 'speed, footwork, and not being where the blow lands',
  vit: 'stamina, bulk, and keeping other people upright',
  int: 'worked power, whatever this world calls it — figures, machines, chemistry',
  wis: 'reading people and places, and seeing it coming',
  cha: 'presence, and getting what you want out of people',
  luk: 'the way things happen to fall out for you',
};

/* -------------------------------------------------------------------------- */
/* Drawing them                                                                */
/* -------------------------------------------------------------------------- */

const brief = (primary: Ability, secondary: Ability): string =>
  `${STAT_BRIEF[primary]}, with some ${STAT_BRIEF[secondary]}`;

/**
 * The paths a world offers.
 *
 * Every stat is a primary at least once before any is a primary twice, so no
 * spread is left with nothing to spend on — a character who poured everything
 * into LUK must still find somewhere to put their points. Beyond that the
 * pairings are drawn, so two worlds pair the same nine stats differently.
 */
export function pathsFor(seed: number, count?: number): PathShape[] {
  const rng = mulberry32((seed ^ 0x9a7b5) >>> 0);
  const want = count ?? MIN_PATHS + Math.floor(rng() * (MAX_PATHS - MIN_PATHS + 1));

  const deck = [...ABILITIES].sort(() => rng() - 0.5);
  const paths: PathShape[] = [];

  for (let i = 0; i < want; i++) {
    const primary = deck[i % deck.length];

    // A secondary that is not the primary, so a path is genuinely a pair.
    const others = ABILITIES.filter((a) => a !== primary);
    const secondary = others[Math.floor(rng() * others.length)];

    paths.push({
      id: `path_${primary}_${i}`,
      primary,
      secondary,
      needs: MIN_GATE + Math.floor(rng() * (MAX_GATE - MIN_GATE + 1)),
      brief: brief(primary, secondary),
    });
  }

  return paths;
}

/* -------------------------------------------------------------------------- */
/* Which are open to a given character                                         */
/* -------------------------------------------------------------------------- */

/** What a class does to a gate: favoured paths open sooner, others later. */
export type Lean = { favours?: readonly Ability[]; against?: readonly Ability[] };

export const FAVOUR_SHIFT = 2;

/**
 * The score this character actually needs, after their class leans on it.
 *
 * A LEAN IS A PRICE, NOT A LOCK. The old `forbidden` was a boolean — no score
 * ever got a Fighter into the figure-arts. Shifting the gate instead means
 * "raise the stat far enough and you get there anyway", which is the whole
 * promise of a stat system, and it is why a class can lean without making a
 * build impossible.
 */
export function gateFor(path: PathShape, lean: Lean = {}): number {
  const favoured = lean.favours?.includes(path.primary) ? -FAVOUR_SHIFT : 0;
  const resisted = lean.against?.includes(path.primary) ? FAVOUR_SHIFT : 0;
  return Math.max(MIN_GATE - FAVOUR_SHIFT, path.needs + favoured + resisted);
}

/**
 * Whether a spread opens a path.
 *
 * MONOTONIC IN THE SCORE, and that is load-bearing: raising a stat may only
 * ever open a path and must never close one. A path that could vanish would
 * take its nodes with it, orphaning points already spent — the same failure as
 * a trait whose id no longer resolves.
 */
export const isOpen = (path: PathShape, scores: Record<Ability, number>, lean: Lean = {}): boolean =>
  scores[path.primary] >= gateFor(path, lean);

export const openPaths = (
  paths: readonly PathShape[],
  scores: Record<Ability, number>,
  lean: Lean = {},
): PathShape[] => paths.filter((p) => isOpen(p, scores, lean));
