import type { Ability, Condition } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { Item } from '../items/types.ts';
import type { ArchetypeId } from '../play/archetypes.ts';
import type { GraftSpec } from '../play/graft.ts';
import type { Skill } from '../session/sheet.ts';
import type { ActiveEffect, ActiveKind, ActiveSkill } from './active.ts';

/**
 * Where active skills come from.
 *
 * Two sources, which is the first branch of the three the design has always
 * called for: what your background taught you, and what you find written down.
 *
 * The model names a skill and says whether it is combat, social or utility.
 * The code decides what that means numerically — the same split as the spear
 * that was not a weapon. A model choosing "stuns for 3 rounds, unlimited uses"
 * would be unbalanceable, and it has no way to know what the fight economy can
 * absorb.
 */

/** Stable number from a string, so the same skill always resolves the same way. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const HINDRANCES: Condition[] = ['prone', 'restrained', 'blinded', 'stunned'];

/**
 * What a named skill actually does.
 *
 * Combat skills either take a foe out of the fight briefly or put the user back
 * on their feet; social and utility skills sharpen the ability they are named
 * for, which is what makes them worth having when the Director calls a check.
 */
function effectFor(kind: ActiveKind, ability: Ability, seed: number): ActiveEffect {
  const rng = mulberry32(seed);

  if (kind === 'combat') {
    const roll = rng();
    if (roll < 0.55) {
      // Stun is the strongest of these, so it is the rarest and shortest.
      const condition = HINDRANCES[Math.floor(rng() * HINDRANCES.length)];
      return { kind: 'hinder', condition, rounds: condition === 'stunned' ? 1 : 2 };
    }
    if (roll < 0.8) return { kind: 'mend', amount: 6 };
    return { kind: 'rally', condition: 'prone' };
  }

  return { kind: 'edge', ability, bonus: 2 };
}

/**
 * Turn a generated skill into one that works.
 *
 * Keeps the model's name and description — that is the part it is good at — and
 * replaces the missing half.
 */
export function activate(skill: Skill): ActiveSkill {
  const seed = hash(skill.id + skill.name);
  const kind = skill.kind as ActiveKind;
  const effect = effectFor(kind, skill.ability, seed);

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind,
    ability: skill.ability,
    effect,
    range: effect.kind === 'hinder' ? 1 : 0,
    // Combat skills are scarce; a passive edge is always on, so its count is
    // irrelevant and simply never spent.
    usesPerRest: kind === 'combat' ? 2 : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Books                                                                       */
/* -------------------------------------------------------------------------- */

const TITLES = {
  en: ['A Soldier’s Notes', 'The Quiet Hand', 'On Holding Ground', 'Field Marks', 'The Long Watch'],
  th: ['บันทึกของทหาร', 'มือที่เงียบงัน', 'ว่าด้วยการยืนหยัด', 'รอยในสนาม', 'การเฝ้ายามอันยาวนาน'],
} as const;

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * A skill book: loot that teaches something.
 *
 * The item carries the skill it teaches, so reading it is a normal inventory
 * action rather than a special case, and the skill travels with the save
 * without needing a separate table.
 */
export type SkillBook = Item & {
  teaches: ActiveSkill;
  /**
   * The set of nodes reading it opens.
   *
   * Always PARALLEL: a book free-stands, because you did not walk to it — you
   * read your way in, and the book was the entry price. It is the one thing on
   * the tree contiguity has nothing to say about.
   */
  set: GraftSpec;
  /**
   * Another book that has to have been read first.
   *
   * What makes a shelf out of a pile. A chain this tower cannot actually supply
   * is discarded before it ships — the same proof that keeps an unobtainable
   * Signet out.
   */
  needsBook?: string;
};

/**
 * The volumes a tower prints, in order.
 *
 * A chain is only worth having if the earlier volumes can actually be found, so
 * the whole series is derived from the world seed rather than rolled per drop.
 * That is what lets `provableChain` say, before anything ships, whether volume
 * three is reachable at all.
 */
export const CHAIN_LENGTH = 3;

/** The floor a given volume of a series starts appearing on. */
export const volumeFloor = (series: number, volume: number): number =>
  1 + (series % 3) + volume * 4;

/** A stable id for one volume, so the same series is the same series everywhere. */
export const volumeId = (series: number, volume: number): string => `vol_${series}_${volume}`;

/**
 * Whether a series can actually be read to the end in this tower.
 *
 * The same failure the Signet walk exists to prevent: a book whose prerequisite
 * never drops is a permanent dead end the player cannot diagnose — it simply
 * refuses to open, forever, with no way to learn why.
 */
export function provableChain(series: number, maxFloor: number): boolean {
  for (let volume = 0; volume < CHAIN_LENGTH; volume++) {
    if (volumeFloor(series, volume) > maxFloor) return false;
  }
  return true;
}

/**
 * A book that belongs to a series.
 *
 * Volume nought stands alone; every later volume needs the one before it, which
 * is what turns a pile into a shelf.
 */
export function chainedBook(
  _rng: Rng,
  series: number,
  volume: number,
  language: 'th' | 'en' = 'en',
): SkillBook {
  const floor = volumeFloor(series, volume);

  /*
   * Each volume gets its OWN generator, keyed to the volume rather than to
   * whatever state the caller's happened to be in.
   *
   * Sharing one made every volume of a series teach the same skill, so the
   * second was refused as "you already know what is in it" — a chain of
   * identical books, which is no chain at all.
   */
  const own = mulberry32(hash(volumeId(series, volume)));
  const book = skillBook(own, floor, language);
  const id = volumeId(series, volume);

  return {
    ...book,
    id,
    name: `${book.name} (${volume + 1})`,
    // Pinned to the volume too, so two volumes can never collide.
    teaches: { ...book.teaches, id: `skill_${id}` },
    needsBook: volume > 0 ? volumeId(series, volume - 1) : undefined,
    // A later volume is worth more, and asks more of the shelf below it.
    set: { ...book.set, size: Math.min(5, book.set.size + volume) },
  };
}

export function skillBook(rng: Rng, floor: number, language: 'th' | 'en' = 'en'): SkillBook {
  const titles = TITLES[language];
  const title = titles[Math.floor(rng() * titles.length)];
  const kind: ActiveKind = rng() < 0.6 ? 'combat' : rng() < 0.5 ? 'utility' : 'social';
  const ability = ABILITIES[Math.floor(rng() * ABILITIES.length)];
  const seed = Math.floor(rng() * 1e9);

  const taught: ActiveSkill = {
    id: `skill_book_${seed.toString(36)}`,
    name: title,
    description: language === 'th' ? 'สิ่งที่ใครบางคนจดไว้ก่อนคุณ' : 'Someone worked this out before you did.',
    kind,
    ability,
    effect: effectFor(kind, ability, seed),
    range: 1,
    usesPerRest: kind === 'combat' ? 2 : 0,
    // Deeper books ask more of the reader, which is what keeps an early find
    // from handing over a late-game skill.
    requires: floor >= 8 ? [{ kind: 'level', atLeast: Math.min(12, Math.floor(floor / 2)) }] : undefined,
  };

  // Which discipline the set belongs to. Deeper books lean on the harder ones.
  const family = ABILITY_TO_DISCIPLINE[ability];

  return {
    id: `book_${seed.toString(36)}`,
    name: title,
    description: language === 'th' ? 'อ่านเพื่อเรียนรู้' : 'Read it to learn what is in it.',
    kind: 'consumable',
    // Reading is using: the book is spent and the skill is kept.
    effect: { kind: 'restore', supply: 0 },
    stackable: false,
    value: 60 + floor * 10,
    foundOn: floor,
    teaches: taught,
    set: { archetype: family, entry: 'parallel', size: floor >= 10 ? 3 : 2 },
  };
}

/**
 * Which discipline a book's set belongs to.
 *
 * Keyed off the ability it teaches, so a book about steadiness grows shield
 * nodes and one about figures grows magic ones.
 */
const ABILITY_TO_DISCIPLINE: Record<Ability, ArchetypeId> = {
  str: 'sword',
  dex: 'bow',
  con: 'survival',
  int: 'magic',
  wis: 'wisdom',
  cha: 'song',
};

export const isSkillBook = (item: Item): item is SkillBook =>
  typeof (item as SkillBook).teaches === 'object' && (item as SkillBook).teaches !== null;
