import { mulberry32 } from '../engine/roll.ts';

/**
 * What a world is ABOUT.
 *
 * The vocabulary that lets a want and a piece of lore be compared. A character
 * wants something; a history is about something; if they meet, the history
 * means something to that person and to nobody else.
 *
 * GENERATED PER WORLD, NOT HARDCODED — which is what makes the matching
 * dynamic without making it opaque. A drowned coast mints subjects like the
 * flood, the old highways, salvage; a kingdom mints a dynasty, a border war, a
 * cathedral. Within one world the set is CLOSED, so matching is a set
 * intersection: cheap, checkable, exactly testable, and the model dresses it
 * rather than deciding it.
 *
 * The property this buys, and the reason it beats free text or embeddings: a
 * world's drives and its lore are drawn from THE SAME POOL, so they are
 * guaranteed to speak the same language. Every drive can be PROVEN to have
 * lore that could satisfy it, the way `admissible` proves every Signet
 * reachable. Free text cannot promise that and a similarity score can only
 * approximate it.
 */

/**
 * The archetypal kinds a subject can be.
 *
 * Authored, and deliberately so: these are the shapes a thing worth caring
 * about takes, and they are as true of a kingdom as of a wreck. The WORDS are
 * the world's business; the kinds are not.
 */
export const SUBJECT_KINDS = [
  'a war', 'a house', 'a craft', 'a place', 'a person', 'a loss',
  'the tower', 'a faith', 'a road', 'a beast', 'a ruin', 'a bargain',
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type SubjectId = string;

export type Subject = {
  id: SubjectId;
  kind: SubjectKind;
  /** What this world calls it. A fallback until the model names it. */
  name: string;
};

export const MIN_SUBJECTS = 10;
export const MAX_SUBJECTS = 14;

/** Fallback words, so a world is playable before anything is named. */
const FALLBACK: Record<SubjectKind, string[]> = {
  'a war': ['the long quarrel', 'the burning', 'the last muster'],
  'a house': ['the old family', 'the fallen line', 'the keepers'],
  'a craft': ['the making', 'the trade', 'the old work'],
  'a place': ['the deep ground', 'the drowned quarter', 'the high road'],
  'a person': ['the one who left', 'the first climber', 'the quiet one'],
  'a loss': ['what was taken', 'the empty chair', 'the year of leaving'],
  'the tower': ['the climb', 'what waits above', 'the rule of the stair'],
  'a faith': ['the old promise', 'the watchers', 'the observance'],
  'a road': ['the way out', 'the crossing', 'the salt road'],
  'a beast': ['the thing in the dark', 'the pack', 'what hunts here'],
  'a ruin': ['what fell', 'the broken works', 'the sunken hall'],
  'a bargain': ['the debt', 'the agreement', 'what was promised'],
};

/**
 * This world's subjects.
 *
 * Kinds are DEALT from a shuffled deck rather than drawn, so a world uses every
 * kind of thing it has before repeating any — the same fix duplicate Signets
 * and duplicate class roles both needed. Where a kind does repeat, it takes a
 * different word and is a genuinely different subject.
 */
export function subjectsFor(seed: number): Subject[] {
  const rng = mulberry32((seed ^ 0x5ab1) >>> 0);
  const want = MIN_SUBJECTS + Math.floor(rng() * (MAX_SUBJECTS - MIN_SUBJECTS + 1));

  const deck = [...SUBJECT_KINDS].sort(() => rng() - 0.5);
  const used = new Set<string>();
  const out: Subject[] = [];

  for (let i = 0; i < want; i++) {
    const kind = deck[i % deck.length];
    const words = FALLBACK[kind];
    // A name already spoken for is skipped rather than repeated, so two
    // subjects are never the same thing under one label.
    let name = words[Math.floor(rng() * words.length)];
    for (let tries = 0; used.has(name) && tries < words.length; tries++) {
      name = words[(words.indexOf(name) + 1) % words.length];
    }
    if (used.has(name)) continue;
    used.add(name);
    out.push({ id: `sub_${i}`, kind, name });
  }

  return out;
}

export const subjectById = (subjects: readonly Subject[], id: SubjectId): Subject | null =>
  subjects.find((s) => s.id === id) ?? null;
