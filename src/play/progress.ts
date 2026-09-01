import { abilityMod } from '../combat/types.ts';
import type { Abilities } from '../combat/types.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { derive } from '../session/sheet.ts';
import type { Inventory } from '../items/types.ts';

/**
 * Getting stronger.
 *
 * Two sources, deliberately. Experience rewards fighting; floor milestones
 * reward CLIMBING, which is the thing the game is actually about.
 *
 * The tower regenerates floors, so kill experience alone would make farming the
 * shallows the optimal strategy forever. `depthFactor` is the answer: what a
 * fight is worth falls away sharply once you are stronger than the floor you
 * are on, so grinding floor 2 at level 8 earns almost nothing.
 */

/** Experience needed to go from `level` to the next one. */
export const xpToNext = (level: number): number => 100 * Math.max(1, level);

/** Total experience banked at the start of a level. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < Math.max(1, level); n++) total += xpToNext(n);
  return total;
}

/**
 * How much a floor is worth to a character of this level.
 *
 * Squared so the fall-off bites: at level 8 on floor 2 this is 0.06, which is
 * the point.
 */
export function depthFactor(floor: number, level: number): number {
  const ratio = Math.max(0, floor) / Math.max(1, level);
  return Math.min(1, ratio) ** 2;
}

/** Experience for a won fight. */
export const xpForFight = (floor: number, level: number, foesKilled: number): number =>
  Math.round((10 + 8 * Math.max(0, floor)) * Math.max(1, foesKilled) * depthFactor(floor, level));

/**
 * Experience for reaching a depth for the first time.
 *
 * Not subject to `depthFactor` — a new deepest floor is by definition not
 * something you can farm.
 */
export const xpForNewDepth = (floor: number): number => 60 * Math.max(1, floor);

/**
 * One passive point per level, as the tree expects.
 *
 * Ability points are rarer on purpose. Traits gate on scores like "str 20+",
 * and if levelling handed those out freely the gate would be a formality; the
 * tree is the ordinary route to a higher score, and a raw point is the
 * occasional shortcut.
 */
export const SKILL_POINTS_PER_LEVEL = 1;
export const LEVELS_PER_ABILITY_POINT = 4;

/** Ability points earned crossing from one level to another. */
export const abilityPointsBetween = (from: number, to: number): number =>
  Math.floor(to / LEVELS_PER_ABILITY_POINT) - Math.floor(from / LEVELS_PER_ABILITY_POINT);

export type LevelUp = { from: number; to: number; pointsGained: number; skillPointsGained: number };

/**
 * Bank experience and level up as far as it carries.
 *
 * Returns the new sheet plus what happened, because the UI has to be able to
 * say "you reached level 4" and the Writer has to be able to narrate it.
 */
export function grantXp(sheet: CharacterSheet, amount: number): { sheet: CharacterSheet; levelled: LevelUp | null } {
  if (amount <= 0) return { sheet, levelled: null };

  const from = Math.max(1, sheet.level);
  let level = from;
  let xp = (sheet.xp ?? 0) + amount;

  // Bounded: a single windfall should not be able to spin this forever.
  while (xp >= xpToNext(level) && level - from < 20) {
    xp -= xpToNext(level);
    level += 1;
  }

  const gained = abilityPointsBetween(from, level);
  const skillGained = (level - from) * SKILL_POINTS_PER_LEVEL;
  const next: CharacterSheet = {
    ...sheet,
    xp,
    level,
    abilityPoints: (sheet.abilityPoints ?? 0) + gained,
    skillPoints: (sheet.skillPoints ?? 0) + skillGained,
  };
  return {
    sheet: next,
    levelled: level > from ? { from, to: level, pointsGained: gained, skillPointsGained: skillGained } : null,
  };
}

/**
 * Put a point into a score.
 *
 * Capped at 20, the same ceiling traits gate on. Refusing rather than silently
 * clamping keeps the panel honest about what it spent.
 */
export function spendAbilityPoint(
  sheet: CharacterSheet,
  ability: keyof Abilities,
  inventory?: Inventory,
): { sheet: CharacterSheet; error: string | null } {
  if ((sheet.abilityPoints ?? 0) <= 0) return { sheet, error: 'you have no points to spend' };

  const current = derive(sheet, inventory).abilities[ability];
  if (current >= 20) return { sheet, error: `${ability} is already at 20` };

  return {
    sheet: {
      ...sheet,
      abilityPoints: (sheet.abilityPoints ?? 0) - 1,
      spentAbilities: { ...sheet.spentAbilities, [ability]: (sheet.spentAbilities?.[ability] ?? 0) + 1 },
    },
    error: null,
  };
}

/** Hit points move when constitution or level does. */
export const hpAfterGrowth = (sheet: CharacterSheet, inventory: Inventory, currentHp: number, previousMax: number) => {
  const maxHp = derive(sheet, inventory).maxHp;
  // Gaining a level should not also heal you; you keep the wound, not the ratio.
  return { maxHp, hp: Math.max(1, Math.min(maxHp, currentHp + Math.max(0, maxHp - previousMax))) };
};

export const modifierFor = abilityMod;
