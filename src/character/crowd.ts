import { bow, sword } from '../combat/fixtures.ts';
import { expectedPcLevel, referencePc, scaleFoe } from '../combat/statblock.ts';
import type { FoeRole } from '../combat/statblock.ts';
import { abilityMod } from '../combat/types.ts';
import type { Abilities, Attack } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { armour, weapon } from '../items/catalogue.ts';
import { PRISTINE } from '../items/instance.ts';
import type { Rarity } from '../items/instance.ts';
import { addItem, emptyInventory, equip, withInstance } from '../items/types.ts';
import type { Inventory, Item } from '../items/types.ts';
import { background, sheet as blankSheet } from '../session/fixtures.ts';
import { toCombatant } from '../session/sheet.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { HP_AT_FIRST, HP_PER_LEVEL } from '../session/sheet.ts';
import { planFor, slotsFor } from './bodyplan.ts';
import { derivePopulation, sizeIn } from './population.ts';
import { packAt } from './habitat.ts';
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

/**
 * What a rank is allowed to carry.
 *
 * A CAP, not a choice: gear is solved against the anchor by `gearFor`, and this
 * is the ceiling that keeps a whelp from carrying something worth taking. Rarity
 * caps with it — no looted piece hands over a law exemption or a skill.
 */
const GEAR: Record<Rank, { refine: number; rarity: Rarity }> = {
  whelp: { refine: 0, rarity: 'common' },
  ordinary: { refine: 2, rarity: 'uncommon' },
  veteran: { refine: 4, rarity: 'rare' },
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
 * Who holds a landmark floor: one of the floor's own kind, at the top of its
 * standing.
 *
 * Seeded on the world and the floor ALONE, so the floor model calling it
 * something else changes nothing about what it is — the model names a boss, the
 * engine decides it. Drawn from the population that lives at that depth, so a
 * floor of ash-walkers is held by an ash-walker. Null for a world with no kinds.
 */
export function bossMember(seed: number, nodes: readonly Species[], floor: number): Member | null {
  const group = packAt(seed, nodes, floor);
  if (!group) return null;
  const drawn = crowdMember(seed, derivePopulation(seed, nodes, group, 'boss', floor), floor, 0);
  return drawn ? { ...drawn, rank: 'veteran' } : null;
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

/** What a swing is worth when it lands — the dice, plus the ability behind them. */
export function swing(attack: Attack, abilities: Abilities): number {
  const { count, sides, bonusAbility } = attack.damage;
  return (count * (sides + 1)) / 2 + (bonusAbility ? abilityMod(abilities[bonusAbility] ?? 10) : 0);
}

/**
 * What a swing is worth per ROUND, which is the only number a fight cares about.
 *
 * Matching damage per HIT is the trap: a brute with str 14 and the anchor's foe
 * with str 10 can swing for the same average and land half again as often,
 * because `attackBonus` reads the same ability the damage does. Solving on the
 * per-hit figure alone matched every printed number within a point and still
 * cost the curve twenty points of win rate.
 *
 * The target AC is the reference climber's at the depth the fight is at — the
 * same body `scripts/balance.ts` measures the whole curve against, so the
 * comparison is the one the curve was drawn with.
 */
export function perRound(attack: Attack, abilities: Abilities, proficiency: number, targetAc: number): number {
  const bonus = abilityMod(abilities[attack.ability] ?? 10) + (attack.proficient ? proficiency : 0);
  const lands = Math.min(0.95, Math.max(0.05, (21 + bonus - targetAc) / 20));
  return lands * swing(attack, abilities);
}

/**
 * Gear SOLVED against the anchor, not tuned against it.
 *
 * The same move `levelFor` makes for hit points, for the two things a body
 * CARRIES rather than is: what it swings, and what it turns a blow aside with.
 * Every target comes out of `scaleFoe` — the curve every floor was balanced
 * against — and the search is over the catalogue, which already scales both with
 * the depth a thing was found at.
 *
 * MEASURED ON THE BUILT NUMBERS, not on the item. A first cut compared the
 * item's own dice and plate against the anchor and came out 2 points of damage
 * and up to 4 points of AC too high everywhere, because what a body actually
 * swings is the die PLUS its ability, and what it turns aside is the plate PLUS
 * its agility PLUS whatever the refine grants. Comparing the pieces rather than
 * the fighter is the same mistake the first matchup chart made.
 *
 * The ladder runs out before the curve does. `DIE_STEPS` stops at d12, so a
 * swing caps near 8 and an elite at danger 26 wants 18; past that reach this
 * takes the best it can and the foe is weaker than the anchor. See the open
 * question in DESIGN.
 */
/*
 * ponytail: the search is ~96 builds, which is nothing once per foe and about
 * ten thousand times over when the harness measures a curve — so the answer is
 * kept. Keyed on everything it depends on; unbounded, because a run sees a few
 * hundred distinct bodies at most. Give it a bound if a session ever holds a
 * world long enough for that to stop being true.
 */
const solved = new Map<string, Kit>();

function gearFor(
  seed: number,
  danger: number,
  rank: Rank,
  reach: number,
  who: Member,
  from: string,
  build: Dressed,
): Kit {
  /*
   * The key is everything the answer turns on, and `from` is one of them.
   *
   * Not obviously: `from` only namespaces the instance ids — but a refine's
   * grant is hashed off the instance id by decision (`refineBonus`, so the
   * thing you traded your refine for is THIS object), so the same veteran
   * standing in two places is wearing gear worth a point or two apart, and a
   * kit solved under one namespace is the wrong answer under another. Leaving
   * it out of the key made a d8 veteran wear a coat or nothing depending on
   * what had been built before it.
   */
  const key = `${seed}|${danger}|${rank}|${reach}|${who.subspecies}|${who.profession}|${from}`;
  const had = solved.get(key);
  if (had) return had;

  const found = solveGear(seed, danger, rank, reach, build);
  solved.set(key, found);
  return found;
}

type Kit = { arm: Item | null; coat: Item | null };
type Dressed = (arm: Item | null, coat: Item | null) => { ac: number; perRound: number };

function solveGear(seed: number, danger: number, rank: Rank, reach: number, build: Dressed): Kit {
  const anchor = scaleFoe(danger, ROLE_OF[rank]);
  const targetAc = referencePc(expectedPcLevel(danger)).ac;
  const wantPerRound = perRound(anchor.attack, anchor.abilities, anchor.proficiency, targetAc);

  /*
   * Candidates: every kind of thing the catalogue makes, each at a few depths.
   * The kind comes from the draw `weapon` makes first, so a fresh seed is how
   * the search reaches a sling as well as an axe, and twelve of them is enough
   * to see all five; the depth walks the die ladder.
   */
  const DEPTHS = [1, 5, 9, 13, 17, 21, 25, 29];
  const at = <T,>(make: (rng: ReturnType<typeof mulberry32>, depth: number) => T, salt: number): T[] =>
    Array.from({ length: 12 }, (_, k) => k).flatMap((k) =>
      DEPTHS.map((depth) => make(mulberry32((seed ^ salt ^ (k * 7919)) >>> 0), depth)));

  // SOLVED ONE TERM AT A TIME, because they barely interact: a coat does not
  // change what a body swings and a weapon does not change what it turns aside.
  // Searching the product instead meant sixteen hundred builds per foe.
  const nearest = <T,>(candidates: readonly T[], off: (one: T) => number): T =>
    candidates.reduce((best, one) => (off(one) < off(best) ? one : best));

  /*
   * REACH IS NOT NEGOTIABLE, and finding that out cost the curve thirty points.
   *
   * A first cut minimised damage alone and handed nearly every body a SLING,
   * because a d4 was the closest thing to what a shallow foe swings — so foes
   * that used to spend two rounds crossing the arena opened fire on round one
   * instead, and the measured win rate fell from 94% to 65% at danger 1 with
   * every other number matching the anchor within a point. A trade decides
   * reach (a hunter carries a bow), so the search only ever considers things of
   * the right reach and matches damage within that.
   */
  const armed = at(weapon, 0x9ea7).filter((one) => (one.attack!.range > 1) === (reach > 1));
  const arm = nearest(
    armed.length > 0 ? armed : at(weapon, 0x9ea7),
    (one) => Math.abs(build(one, null).perRound - wantPerRound),
  );

  // A whelp carries nothing worth taking, so it fights in its own skin — and
  // nothing needs a coat to be as easy to hit as the anchor says it is.
  if (rank === 'whelp') return { arm, coat: null };
  const coat = nearest(
    [null, ...at(armour, 0x5ca1)],
    (one) => Math.abs(build(arm, one).ac - anchor.ac),
  );
  return { arm, coat };
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

  const tier = GEAR[who.rank];

  // Refined to its standing, and worn through its own body: a handless kind
  // carries what it cannot hold, exactly as a climber does.
  const plan = planFor(seed, nodes, who.subspecies);
  const rules = { ...STANDARD, gear: { ...STANDARD.gear, slots: slotsFor(STANDARD, plan) } };

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
  const dress = (arm: Item | null, coat: Item | null): Inventory => {
    let bag = emptyInventory();
    if (arm) bag = addItem(bag, arm, 1, from);
    if (coat) bag = addItem(bag, coat, 1, from);
    const wearRng = mulberry32((seed ^ 0x9ea7 ^ (danger * 31)) >>> 0);
    for (const held of bag.held) {
      /*
       * AND IT ARRIVES USED. Gear on a body has been carried and swung; handing
       * it over pristine would skip the smith economy `refineCost` and
       * `enhanceCost` exist to be, since a pristine find needs no repair and a
       * repair is what a lifespan is made of. Worn, never wrecked: what is taken
       * is still worth taking.
       */
      const wear = PRISTINE - Math.floor(wearRng() * (PRISTINE * 0.55)) - Math.floor(PRISTINE * 0.15);
      bag = withInstance(bag, held.instance.id, {
        ...held.instance,
        condition: wear,
        ...(tier.refine > 0 ? { refine: tier.refine, rarity: tier.rarity } : {}),
      });
      bag = equip(bag, held.instance.id, rules).inventory;
    }
    return bag;
  };

  const { arm, coat } = gearFor(seed, danger, who.rank, trade.attack.range, who, from, (tryArm, tryCoat) => {
    const built = toCombatant({ ...sheet, level }, 'x', dress(tryArm, tryCoat));
    return {
      ac: built.ac,
      perRound: perRound(built.attacks[0], built.abilities, built.proficiency, referencePc(expectedPcLevel(danger)).ac),
    };
  });

  const inventory = dress(arm, coat);

  return { sheet, inventory };
}
