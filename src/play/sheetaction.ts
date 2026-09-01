import type { Abilities } from '../combat/types.ts';
import { equip, unequip } from '../items/types.ts';
import type { Slot } from '../items/types.ts';
import { allocate } from './allocate.ts';
import { hpAfterGrowth, spendAbilityPoint } from './progress.ts';
import { skillTreeFor } from './skilltree.ts';
import type { PlayState } from './state.ts';
import { awardTraits } from './traits.ts';
import type { TraitContext } from './traits.ts';
import { TRAITS } from './traitbook.ts';
import { useItem } from './rest.ts';

/**
 * Things the player does to their own sheet.
 *
 * These are the panel actions — spending a point, taking a tree node, putting
 * on armour, drinking something from the pack — and they are EVENTS like
 * everything else. State is a fold of the log, so a change that only ever
 * happened in memory is a change that vanishes on reload. Two bugs of exactly
 * that shape have already been fixed in this codebase; this is the same trap.
 *
 * They are a separate event kind from a turn because they cost no model call.
 * Equipping a helmet is bookkeeping, not a story beat, and paying a Writer
 * round-trip to narrate it would be waste. Drinking a potion is arguably a beat
 * — that one is available through the main prompt too, where it does narrate.
 */

export type SheetAction =
  | { type: 'spendAbility'; ability: keyof Abilities }
  | { type: 'allocate'; node: string }
  | { type: 'equip'; item: string }
  | { type: 'unequip'; slot: Slot }
  | { type: 'use'; item: string };

/** The log entry. Mirrors TurnRecord's shape so the fold can tell them apart. */
export type SheetRecord = { kind: 'sheet'; action: SheetAction };

export const sheetRecord = (action: SheetAction): SheetRecord => ({ kind: 'sheet', action });

export type SheetResult = { state: PlayState; error: string | null; note: string | null };

export const treeFor = (state: PlayState) =>
  skillTreeFor(state.world.seed, state.sheet.background.id, state.sheet.language, state.sheet.background.name);

export const contextOf = (state: PlayState): TraitContext => ({
  sheet: state.sheet,
  inventory: state.pc.inventory,
  counters: state.sheet.counters,
  personality: state.sheet.personality,
});

/**
 * Apply one panel action.
 *
 * Deterministic and model-free, so replaying the log reproduces the same sheet.
 * Every branch re-derives hit points afterwards, because a point in
 * constitution, a tree node and a suit of armour can all move the maximum.
 */
export function applySheetAction(state: PlayState, action: SheetAction): SheetResult {
  if (state.ended) return { state, error: 'this run is over', note: null };

  switch (action.type) {
    case 'spendAbility': {
      const spent = spendAbilityPoint(state.sheet, action.ability, state.pc.inventory);
      if (spent.error) return { state, error: spent.error, note: null };
      return settle({ ...state, sheet: spent.sheet }, state, `${action.ability} raised`);
    }

    case 'allocate': {
      const tree = treeFor(state);
      const taken = allocate(tree, contextOf(state), action.node);
      if (taken.error) return { state, error: taken.error, note: null };
      return settle({ ...state, sheet: taken.sheet }, state, `${taken.node?.name ?? 'node'} taken`);
    }

    case 'equip': {
      const worn = equip(state.pc.inventory, action.item);
      if (worn.error) return { state, error: worn.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: worn.inventory } }, state, 'equipped');
    }

    case 'unequip':
      return settle(
        { ...state, pc: { ...state.pc, inventory: unequip(state.pc.inventory, action.slot) } },
        state,
        'put away',
      );

    case 'use': {
      const used = useItem(state, action.item);
      if (used.error) return { state, error: used.error, note: null };
      return settle(used.state, state, used.narration);
    }
  }
}

/**
 * Re-derive what the change implies, then check whether it earned a trait.
 *
 * Traits are evaluated here as well as in the turn fold, because a trait can
 * gate on a score — and a score can move from a panel without a turn ever being
 * taken.
 */
function settle(next: PlayState, before: PlayState, note: string | null): SheetResult {
  const grown = hpAfterGrowth(next.sheet, next.pc.inventory, next.pc.hp, before.pc.maxHp);
  const awarded = awardTraits(TRAITS, next.sheet, next.pc.inventory);

  return {
    state: {
      ...next,
      sheet: awarded.sheet,
      pc: { ...next.pc, hp: grown.hp, maxHp: grown.maxHp },
    },
    error: null,
    note: awarded.earned.length ? `${note ?? 'done'} · ${awarded.earned.map((t) => t.name).join(', ')}` : note,
  };
}
