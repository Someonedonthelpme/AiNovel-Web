import type { ActiveCondition } from '../combat/types.ts';
import { RATION_ID } from '../items/catalogue.ts';
import { countOf, findItem, removeItem } from '../items/types.ts';
import type { Inventory, ItemEffect } from '../items/types.ts';
import { derive } from '../session/sheet.ts';
import { refreshUses } from '../skills/active.ts';
import { isSkillBook } from '../skills/book.ts';
import { conditionMet } from './traits.ts';
import { activeRegion, currentPlace } from '../world/travel.ts';
import type { PlayState } from './state.ts';

/**
 * Catching your breath, and drinking what you carry.
 *
 * The shape of rest is the whole difficulty curve. Free healing between fights
 * would make encounter tuning decorative, so recovery is a SUPPLY ECONOMY: a
 * short rest anywhere spends food, and a full recovery means walking back down
 * to town. That is what turns a climb into a decision — how deep can you get
 * before you have to go home?
 */

export const SHORT_REST_TURNS = 1;
export const LONG_REST_TURNS = 8;

export type RestKind = 'short' | 'long';

export type RestCheck = { ok: boolean; reason: string | null };

/**
 * Whether a rest is allowed here.
 *
 * A long rest needs a settlement on the ground floor. Allowing it at any
 * settlement would let a camp on floor 15 undo the entire climb.
 */
export function canRest(state: PlayState, kind: RestKind): RestCheck {
  if (state.combat && !state.combat.over) return { ok: false, reason: 'not in the middle of a fight' };
  if (state.ended) return { ok: false, reason: 'this run is over' };

  if (kind === 'short') {
    if (countOf(state.pc.inventory, RATION_ID) <= 0) {
      return { ok: false, reason: 'you have nothing left to eat' };
    }
    return { ok: true, reason: null };
  }

  const region = activeRegion(state.world);
  const place = currentPlace(state.world);
  if (!region || !place) return { ok: false, reason: 'there is nowhere to bed down here' };
  if (place.kind !== 'settlement' || region.floor !== 0) {
    return { ok: false, reason: "a real night of sleep means going back down to town" };
  }
  return { ok: true, reason: null };
}

export type RestResult = {
  state: PlayState;
  healed: number;
  error: string | null;
  /** Turns that passed, so agendas and the world clock can move. */
  turnsSpent: number;
};

/**
 * Take the rest.
 *
 * A short rest returns a quarter of your maximum and costs a ration. A long one
 * returns everything and settles the mind — and takes long enough that the
 * world has moved on when you wake.
 */
export function takeRest(state: PlayState, kind: RestKind): RestResult {
  const check = canRest(state, kind);
  if (!check.ok) return { state, healed: 0, error: check.reason, turnsSpent: 0 };

  const maxHp = derive(state.sheet, state.pc.inventory).maxHp;
  const before = state.pc.hp;

  if (kind === 'short') {
    const healed = Math.max(1, Math.floor(maxHp / 4));
    const inventory = removeItem(state.pc.inventory, RATION_ID, 1);
    return {
      state: {
        ...state,
        // Actives come back on any rest: that is what puts them on the same
        // supply economy as healing, rather than on a timer.
        pc: { ...state.pc, hp: Math.min(maxHp, before + healed), maxHp, inventory, skillUses: refreshUses() },
        sheet: { ...state.sheet, mental: easedShort(state.sheet.mental) },
        world: { ...state.world, turn: state.world.turn + SHORT_REST_TURNS },
      },
      healed: Math.min(maxHp, before + healed) - before,
      error: null,
      turnsSpent: SHORT_REST_TURNS,
    };
  }

  return {
    state: {
      ...state,
      pc: { ...state.pc, hp: maxHp, maxHp, conditions: [], skillUses: refreshUses() },
      sheet: { ...state.sheet, mental: { stress: 0, morale: state.sheet.mental.morale, fatigue: 0 } },
      world: { ...state.world, turn: state.world.turn + LONG_REST_TURNS },
    },
    healed: maxHp - before,
    error: null,
    turnsSpent: LONG_REST_TURNS,
  };
}

/** A short rest takes the edge off without resetting anyone. */
const easedShort = (mental: PlayState['sheet']['mental']) => ({
  ...mental,
  stress: Math.max(0, mental.stress - 2),
  fatigue: Math.max(0, mental.fatigue - 2),
});

/* -------------------------------------------------------------------------- */
/* Using what you carry                                                        */
/* -------------------------------------------------------------------------- */

export type UseResult = { state: PlayState; narration: string | null; error: string | null };

/**
 * Drink it, apply it, eat it.
 *
 * The Director may say WHICH item was used; the item says what that does. A
 * model that could name a healing amount would heal for whatever the scene felt
 * like, which is the same reason it never decides a dice roll.
 */
export function useItem(state: PlayState, itemId: string): UseResult {
  const item = findItem(state.pc.inventory, itemId);
  if (!item) return { state, narration: null, error: 'you are not carrying that' };
  if (item.kind !== 'consumable' || !item.effect) {
    return { state, narration: null, error: `${item.name} is not something you can use up` };
  }

  // Reading is using: the book is spent, the skill is kept.
  if (isSkillBook(item)) {
    const already = (state.sheet.learned ?? []).some((s) => s.id === item.teaches.id);
    if (already) return { state, narration: null, error: 'you already know what is in it' };

    const context = { sheet: state.sheet, inventory: state.pc.inventory, counters: state.sheet.counters, personality: state.sheet.personality };
    const notReady = (item.teaches.requires ?? []).filter((c) => !conditionMet(c, context));
    if (notReady.length) {
      return { state, narration: null, error: 'you read it, and none of it makes sense yet' };
    }

    return {
      state: {
        ...state,
        sheet: { ...state.sheet, learned: [...(state.sheet.learned ?? []), item.teaches] },
        pc: { ...state.pc, inventory: removeItem(state.pc.inventory, itemId, 1) },
      },
      narration: `learned ${item.teaches.name}`,
      error: null,
    };
  }

  const applied = applyEffect(state, item.effect);
  return {
    state: { ...applied.state, pc: { ...applied.state.pc, inventory: removeItem(applied.state.pc.inventory, itemId, 1) } },
    narration: applied.narration,
    error: null,
  };
}

function applyEffect(state: PlayState, effect: ItemEffect): { state: PlayState; narration: string } {
  const maxHp = derive(state.sheet, state.pc.inventory).maxHp;

  if (effect.kind === 'heal') {
    const hp = Math.min(maxHp, state.pc.hp + effect.amount);
    return {
      state: { ...state, pc: { ...state.pc, hp, maxHp } },
      narration: `${hp - state.pc.hp} back`,
    };
  }

  if (effect.kind === 'cure') {
    const conditions = state.pc.conditions.filter((c: ActiveCondition) => c.kind !== effect.condition);
    return { state: { ...state, pc: { ...state.pc, conditions } }, narration: `no longer ${effect.condition}` };
  }

  if (effect.kind === 'restore') {
    // Eating outside a rest is just eating: it steadies you, nothing more.
    return {
      state: { ...state, sheet: { ...state.sheet, mental: easedShort(state.sheet.mental) } },
      narration: 'steadier',
    };
  }

  // A buff with no combat in progress has nothing to attach to yet; the item is
  // still spent, which is the honest outcome of drinking it at the wrong moment.
  return { state, narration: `${effect.ability} feels sharper` };
}
