import type { ActiveCondition, CombatState } from '../combat/types.ts';
import type { CombatAction } from './combat.ts';
import type { SheetRecord } from './sheetaction.ts';
import type { ClimbRecord } from './climb.ts';
import type { SocialRoll } from '../engine/roll.ts';
import type { SkillUses } from '../skills/active.ts';
import type { Inventory } from '../items/types.ts';
import { addItem, emptyInventory, equip } from '../items/types.ts';
import { namesTheSameThing, rations, weaponFromAttack } from '../items/catalogue.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { derive } from '../session/sheet.ts';
import type { PersonId, World } from '../world/types.ts';

/**
 * The state the play loop folds over.
 *
 * The event log stays the source of truth and `PlayState` is a fold over it, so
 * a session can be replayed, resumed, branched from any turn, or debugged by
 * reading what actually happened. Dice are RECORDED in the turn record rather
 * than re-rolled, which is what keeps the fold deterministic.
 */

export type PlayState = {
  world: World;
  sheet: CharacterSheet;
  pc: {
    hp: number;
    maxHp: number;
    conditions: ActiveCondition[];
    coin: number;
    inventory: Inventory;
    /** Uses spent since the last rest. Refreshed by resting, not by time. */
    /**
     * The two pools every skill is paid for out of. Stamina is the body
     * exerting itself and comes from VIT; mana is the mind concentrating and
     * comes from CON. Which one a skill draws on follows its stat.
     *
     * Carried on the run rather than derived, because what you have SPENT is a
     * thing that happened — the ceilings are derived, the current levels are
     * not.
     */
    stamina: number;
    mana: number;
    skillUses: SkillUses;
  };
  /** The fight in progress, if any. A finished fight is discarded, not kept. */
  combat: CombatState | null;
  ended: null | { reason: string };
};

export const MODES = ['conversation', 'exploration'] as const;
export type Mode = (typeof MODES)[number];

export const CLASSES = ['ADVANCES', 'NEUTRAL', 'DIVERGES', 'IMPOSSIBLE'] as const;
export type Classification = (typeof CLASSES)[number];

/** What the Director is permitted to change. Everything else is engine-owned. */
export type WorldDelta = {
  /** Must be an edge from where the player stands. */
  moveTo?: string;
  /** New canon, embedded for later retrieval by the guard. */
  learnFacts?: string[];
  /** Per-person trust CHANGES, not absolutes. */
  trust?: Record<PersonId, number>;
  flags?: Record<string, boolean>;
  timeSpent?: number;
  /** Finding the way up. */
  revealExit?: string;
  /**
   * A fight breaks out. The Director says only THAT one starts; depth decides
   * what shows up, because the difficulty curve is the whole progression.
   */
  startCombat?: boolean;
  /**
   * Drink it, eat it, apply it.
   *
   * The Director says WHICH item; the item says what it does. A model able to
   * name a healing amount would heal for whatever the scene felt like.
   */
  useItem?: string;
  /** Put something on. Must be equipment the player is carrying. */
  equipItem?: string;
  /**
   * Catch your breath, or sleep properly.
   *
   * Rest is a supply economy rather than a free reset — see `rest.ts`, where
   * the difficulty curve actually lives.
   */
  rest?: 'short' | 'long';
};

export type TurnRecord = {
  kind: 'turn';
  input: string;
  mode: Mode;
  classification: Classification;
  addressed: PersonId | null;
  /** Recorded, never re-rolled. */
  roll: SocialRoll | null;
  /** The validated delta that was actually applied. */
  delta: WorldDelta;
  /** What the Director asked for and was refused, with reasons. */
  rejected: string[];
  prose: string;
  /**
   * The choices made in a fight this turn, if one broke out.
   *
   * A whole encounter is ONE event in the log. Only the decisions are stored —
   * every roll is derived from state, so replaying these actions reproduces the
   * identical fight rather than a differently unlucky one.
   */
  combatActions?: CombatAction[];
};

export type PlayEvent = { kind: 'start' } | TurnRecord | SheetRecord | ClimbRecord;

export function initialPlayState(world: World, sheet: CharacterSheet): PlayState {
  const inventory = startingInventory(sheet);
  // One point in hand at level one, so the tree is something to engage with
  // from the first screen rather than a picture of what might happen later.
  sheet = { ...sheet, skillPoints: sheet.skillPoints ?? 1 };
  const d = derive(sheet, inventory);
  return {
    world,
    sheet,
    pc: { hp: d.maxHp, maxHp: d.maxHp, stamina: d.maxStamina, mana: d.maxMana, conditions: [], coin: 0, inventory, skillUses: {} },
    combat: null,
    ended: null,
  };
}

/**
 * What you set out with.
 *
 * The background's keepsakes, plus food. Rations are not flavour: a short rest
 * spends one, so a character who starts with none cannot use the only healing
 * available outside town until the tower happens to drop some.
 */
export function startingInventory(sheet: CharacterSheet): Inventory {
  let inventory = emptyInventory();

  /*
   * The background declares an attack; that attack becomes a real weapon in the
   * pack, wielded.
   *
   * Before this, a character carried an inert "Short Spear" whose description
   * promised 1d6 damage while the actual attack came from somewhere the player
   * could not see — the item wrote a cheque it could not cash. Building the
   * weapon FROM the declared attack means its numbers are the ones combat was
   * always going to use.
   */
  const [attack] = sheet.background.startingAttacks;
  const named = attack
    ? sheet.background.startingGear.find((g) => namesTheSameThing(g.name, attack.name))
    : undefined;

  for (const item of sheet.background.startingGear) {
    // The one the model named is issued as the weapon below, not twice.
    if (named && item.id === named.id) continue;
    inventory = addItem(inventory, item);
  }

  if (attack) {
    const weapon = weaponFromAttack(attack, named ? { name: named.name, description: named.description } : undefined);
    inventory = addItem(inventory, weapon);
    inventory = equip(inventory, weapon.id).inventory;
  }

  const food = rations(3);
  inventory = addItem(inventory, food.item, food.count);

  // Wear anything else that came with a slot on it.
  for (const item of sheet.background.startingGear) {
    if (item.kind === 'equipment' && item.slot) inventory = equip(inventory, item.id).inventory;
  }
  return inventory;
}
