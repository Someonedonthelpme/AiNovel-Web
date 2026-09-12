import { bow, sword } from '../combat/fixtures.ts';
import { scaleFoe } from '../combat/statblock.ts';
import type { FoeRole } from '../combat/statblock.ts';
import type { Abilities } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { armour, weapon } from '../items/catalogue.ts';
import { PRISTINE } from '../items/instance.ts';
import { addItem, emptyInventory, equip, withInstance } from '../items/types.ts';
import type { Inventory } from '../items/types.ts';
import { background, sheet as blankSheet } from '../session/fixtures.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { HP_AT_FIRST, HP_PER_LEVEL } from '../session/sheet.ts';
import { planFor, slotsFor } from './bodyplan.ts';
import { sizeIn } from './population.ts';
import type { Cohort, Profession } from './population.ts';
import type { Species } from './species.ts';
import { signatureSkill } from './speciesskill.ts';
import { STANDARD } from '../rules/ruleset.ts';

/**
 * Somebody out of the crowd.
 *
 * There are no mass foes: a thing that fights is a CHARACTER, drawn out of a
 * place's population the moment it matters and built from the same sheet the
 * player has. That was already the design — *"a crowd is prose on a Place; the
 * moment the player picks someone out of it, a full persona is created on the
 * spot, deterministically from the seed"* — and statblock foes were the one
 * exception to it, and to every living thing being a subspecies.
 *
 * Role becomes two things the crowd supplies. PROFESSION is what they do, and
 * decides what they fight with. RANK is how good they are, and is pinned to the
 * statblock role it replaces so the difficulty curve does not move.
 */

/** How good they are. Most of a crowd is ordinary. */
export const RANKS = ['whelp', 'ordinary', 'veteran'] as const;
export type Rank = (typeof RANKS)[number];

/** Which statblock role each rank stands in for, so the curve is anchored. */
export const ROLE_OF: Record<Rank, FoeRole> = { whelp: 'minion', ordinary: 'regular', veteran: 'elite' };

/** A rank's gear, capped: a whelp carries nothing worth taking. */
const GEAR: Record<Rank, { refine: number; armour: boolean }> = {
  whelp: { refine: 0, armour: false },
  ordinary: { refine: 2, armour: false },
  veteran: { refine: 4, armour: true },
};

/** Weighted to the middle: a crowd of veterans is not a crowd. */
const RANK_DRAW: readonly Rank[] = ['ordinary', 'ordinary', 'ordinary', 'ordinary', 'whelp', 'veteran'];

/** What a trade fights with, and what it leans on. */
const TRADE: Record<Profession, { attack: typeof sword; lean: Partial<Abilities> }> = {
  hunter: { attack: bow, lean: { dex: 2, agi: 1 } },
  watcher: { attack: sword, lean: { wis: 2, agi: 1 } },
  brute: { attack: sword, lean: { str: 3 } },
  raider: { attack: sword, lean: { str: 1, agi: 2 } },
};

export type Member = { subspecies: string; profession: Profession; rank: Rank };

/**
 * Somebody out of the population here, the same on every replay.
 *
 * DRAWN FROM THE COHORTS, weighted by how many there are — which is what makes
 * killing matter. Thin the wolf-hunters and the next fight is likelier to be
 * something else; clear the place and there is nobody left to draw, which is
 * what `null` means. Before this the lineage was drawn freely from the group, so
 * a population could be emptied and still field the same creatures for ever.
 *
 * Seeded on the depth and which member this is, so a place has a stable cast.
 */
export function crowdMember(
  seed: number,
  cohorts: readonly Cohort[],
  floor: number,
  index: number,
): Member | null {
  const total = sizeIn(cohorts);
  if (total === 0) return null;

  const rng = mulberry32((seed ^ 0xc0d1 ^ (floor * 131) ^ (index * 7919)) >>> 0);

  // Weighted by size: a lineage that has been hunted down is rarer to meet.
  let at = Math.floor(rng() * total);
  const from = cohorts.find((c) => (at -= c.size) < 0) ?? cohorts[0];

  return {
    subspecies: from.subspecies,
    profession: from.profession,
    rank: RANK_DRAW[Math.floor(rng() * RANK_DRAW.length)],
  };
}

/**
 * The level at which a character is as tough as the foe it replaces.
 *
 * Solved rather than tuned by hand: sheet hit points are
 * `HP_AT_FIRST + vit + (level - 1)(HP_PER_LEVEL + vit)`, and the statblock's are
 * the curve everything was balanced against, so this inverts the first to hit the
 * second. Pinning the ANCHOR rather than the level is what lets a character
 * replace a statblock without moving `scripts/balance.ts`.
 */
export function levelFor(danger: number, rank: Rank, vitMod: number): number {
  const target = scaleFoe(danger, ROLE_OF[rank]).hp;
  const perLevel = HP_PER_LEVEL + vitMod;
  const level = 1 + (target - HP_AT_FIRST - vitMod) / Math.max(1, perLevel);
  return Math.max(1, Math.min(20, Math.round(level)));
}

/**
 * Build them: a sheet, and what they are carrying.
 *
 * Gear is DERIVED here rather than stored, from the kind, the trade, the standing
 * and the depth — so a body has something on it worth taking, and what it was
 * worth in the fight is what it is worth in your bag.
 */
export function crowdFighter(
  seed: number,
  nodes: readonly Species[],
  who: Member,
  danger: number,
  from = 'crowd',
): { sheet: CharacterSheet; inventory: Inventory } {
  const kind = nodes.find((n) => n.id === who.subspecies);
  const trade = TRADE[who.profession];
  const template = { ...(kind?.template ?? {}) };

  const base = blankSheet();
  const abilities = { ...base.baseAbilities } as Abilities;
  for (const [ability, by] of Object.entries(trade.lean) as [keyof Abilities, number][]) {
    abilities[ability] = (abilities[ability] ?? 10) + by;
  }

  const vitMod = Math.floor(((abilities.vit ?? 10) + (template.vit ?? 0) - 10) / 2);
  const level = levelFor(danger, who.rank, vitMod);

  const sheet: CharacterSheet = {
    ...base,
    name: who.subspecies,
    species: who.subspecies,
    speciesTemplate: template,
    baseAbilities: abilities,
    level,
    background: background(who.profession, { startingAttacks: [trade.attack], grantsSkills: [] }),
    // A kind's knack. Unused until the AI can cast (step 9), and harmless: an
    // action nobody takes costs nothing.
    ...(kind ? { learned: [signatureSkill(seed, kind as never)] } : {}),
  };

  const rng = mulberry32((seed ^ 0x9ea7 ^ (danger * 31)) >>> 0);
  const tier = GEAR[who.rank];
  /*
   * MINTED UNDER ITS OWN NAME, so what comes off the body keeps its worth.
   *
   * `ItemInstance.id` says everything about an object is keyed off it, and
   * `refineBonus` and `rarityBonus` really do hash it — but `nextInstanceId`
   * only makes it unique within one BAG, so a rare +4 handed over as
   * `weapon_axe#0` into a pack already holding one would be renamed and have
   * its bonuses silently re-roll into other stats. Namespacing the mint to the
   * body it came off makes that collision impossible rather than unlikely.
   */
  let inventory = addItem(emptyInventory(), weapon(rng, Math.max(1, danger)), 1, from);
  if (tier.armour) inventory = addItem(inventory, armour(rng, Math.max(1, danger)), 1, from);

  // Refined to its standing, and worn through its own body: a handless kind
  // carries what it cannot hold, exactly as a climber does.
  const plan = planFor(seed, nodes, who.subspecies);
  const rules = { ...STANDARD, gear: { ...STANDARD.gear, slots: slotsFor(STANDARD, plan) } };
  for (const held of inventory.held) {
    /*
     * AND IT ARRIVES USED. Gear on a body has been carried and swung; handing
     * it over pristine would skip the smith economy `refineCost` and
     * `enhanceCost` exist to be, since a pristine find needs no repair and a
     * repair is what a lifespan is made of. Worn, never wrecked: what is taken
     * is still worth taking.
     */
    const wear = PRISTINE - Math.floor(rng() * (PRISTINE * 0.55)) - Math.floor(PRISTINE * 0.15);
    inventory = withInstance(inventory, held.instance.id, {
      ...held.instance,
      condition: wear,
      ...(tier.refine > 0 ? { refine: tier.refine } : {}),
    });
    inventory = equip(inventory, held.instance.id, rules).inventory;
  }

  return { sheet, inventory };
}
