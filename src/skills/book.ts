import type { Ability, Condition } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { Item } from '../items/types.ts';
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
export type SkillBook = Item & { teaches: ActiveSkill };

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
  };
}

export const isSkillBook = (item: Item): item is SkillBook =>
  typeof (item as SkillBook).teaches === 'object' && (item as SkillBook).teaches !== null;
