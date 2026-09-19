import type { ActiveCondition } from '../combat/types.ts';
import { rulesOf, STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import { NEED_MAX, dispositionOf } from '../character/persona.ts';
import { RATION_ID } from '../items/catalogue.ts';
import { countOf, findItem, removeItem } from '../items/types.ts';
import type { Inventory, ItemEffect } from '../items/types.ts';
import { derive, finalAbilities } from '../session/sheet.ts';
import { abilityMod } from '../combat/types.ts';
import { isSkillBook } from '../skills/book.ts';
import { conditionMet } from './traits.ts';
import { activeRegion, clockOf, currentPlace } from '../world/travel.ts';
import { holderOf } from '../world/holding.ts';
import { PLAYER } from '../social/edge.ts';
import { TICKS_PER_HOUR } from '../world/calendar.ts';
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

export const SHORT_REST_TURNS = STANDARD.rest.shortTurns;
export const LONG_REST_TURNS = STANDARD.rest.longTurns;

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
  // Or a settlement you HOLD, on any floor: a base halfway up the tower (DESIGN 6c).
  if (place.kind !== 'settlement' || (region.floor !== 0 && holderOf(place, state.world.people) !== PLAYER)) {
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
  const { shortTurns, longTurns } = rulesOf(state.world).rest;
  const check = canRest(state, kind);
  if (!check.ok) return { state, healed: 0, error: check.reason, turnsSpent: 0 };

  const derived = derive(state.sheet, state.pc.inventory);
  const { maxHp, maxStamina, maxMana } = derived;
  const before = state.pc.hp;

  if (kind === 'short') {
    /*
     * VIT DRIVES RECOVERY, not just the ceiling.
     *
     * A short rest healed a flat quarter of maximum, so VIT decided how much of
     * you there was and said nothing about how fast you came back — even though
     * "HP recovery" is the second thing the stat claims to do. A hardy person
     * now gets more out of the same hour.
     */
    const vit = abilityMod(finalAbilities(state.sheet, state.pc.inventory).vit);
    const healed = Math.max(1, Math.floor(maxHp / 4) + vit);
    const inventory = removeItem(state.pc.inventory, RATION_ID, 1);
    return {
      state: {
        ...state,
        // Actives come back on any rest: that is what puts them on the same
        // supply economy as healing, rather than on a timer.
        /*
         * A short rest gives back a quarter of each pool, the same fraction it
         * gives back of hit points. Pools are on the supply economy rather
         * than a timer — the same argument that used to put skill uses here,
         * except a shared pool means the choice of what to spend it on
         * survives the rest instead of being reset per skill.
         */
        pc: {
          ...state.pc,
          hp: Math.min(maxHp, before + healed),
          maxHp,
          inventory,
          stamina: Math.min(maxStamina, state.pc.stamina + Math.max(1, Math.floor(maxStamina / 4))),
          mana: Math.min(maxMana, state.pc.mana + Math.max(1, Math.floor(maxMana / 4))),
        },
        sheet: { ...state.sheet, needs: easedShort(state.sheet.needs) },
        // A rest turn is an hour of the world's time per turn it takes (7.1e-i).
        world: { ...state.world, turn: state.world.turn + shortTurns, clock: clockOf(state.world) + shortTurns * TICKS_PER_HOUR },
      },
      healed: Math.min(maxHp, before + healed) - before,
      error: null,
      turnsSpent: shortTurns,
    };
  }

  return {
    state: {
      ...state,
      // A long rest fills everything. It also meets rest and safety outright,
      // which is what lifts the pool CEILINGS back up — resting is the only way
      // to undo what a hard climb took off the top. Food, company and purpose
      // are not things sleeping fixes.
      pc: { ...state.pc, hp: maxHp, maxHp, conditions: [], stamina: maxStamina, mana: maxMana },
      sheet: { ...state.sheet, needs: { ...state.sheet.needs, rest: NEED_MAX, safety: NEED_MAX } },
      world: { ...state.world, turn: state.world.turn + longTurns, clock: clockOf(state.world) + longTurns * TICKS_PER_HOUR },
    },
    healed: maxHp - before,
    error: null,
    turnsSpent: longTurns,
  };
}

/** A short rest takes the edge off without resetting anyone. */
const easedShort = (needs: PlayState['sheet']['needs']) => ({
  ...needs,
  safety: Math.min(NEED_MAX, needs.safety + 2),
  rest: Math.min(NEED_MAX, needs.rest + 2),
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

    /*
     * A chain is only a chain if the order is enforced. Reading the second
     * volume first should fail in a way that tells you a first volume exists —
     * otherwise it reads as the book being broken.
     */
    if (item.needsBook && !(state.sheet.library ?? []).some((r) => r.bookId === item.needsBook)) {
      return { state, narration: null, error: 'this follows on from something you have not read' };
    }

    const context = { sheet: state.sheet, inventory: state.pc.inventory, counters: state.sheet.counters, personality: dispositionOf(state.sheet) };
    const notReady = (item.teaches.requires ?? []).filter((c) => !conditionMet(c, context));
    if (notReady.length) {
      return { state, narration: null, error: 'you read it, and none of it makes sense yet' };
    }

    return {
      state: {
        ...state,
        sheet: {
          ...state.sheet,
          learned: [...(state.sheet.learned ?? []), item.teaches],
          // Onto the shelf, with the branch it grows, so the tree can be built
          // from the sheet without going back to the item.
          library: [...(state.sheet.library ?? []), { bookId: item.id, name: item.name, set: item.set }],
        },
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
      state: { ...state, sheet: { ...state.sheet, needs: easedShort(state.sheet.needs) } },
      narration: 'steadier',
    };
  }

  // A buff with no combat in progress has nothing to attach to yet; the item is
  // still spent, which is the honest outcome of drinking it at the wrong moment.
  return { state, narration: `${effect.ability} feels sharper` };
}
