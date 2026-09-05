import { rulesOf } from '../rules/ruleset.ts';
import { attachPart, detachPart, findHolding, putIn, removeItem, takeOut, withInstance } from '../items/types.ts';
import { enchant, enchantCost, enhance, enhanceCost, refine, refineCost, repair, repairCost } from '../items/refine.ts';
import type { Attempt } from '../items/refine.ts';
import type { ItemInstance } from '../items/instance.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Abilities } from '../combat/types.ts';
import { loreFor } from './lorebook.ts';
import { knowsLore, learn } from './lore.ts';
import { findItem } from '../items/types.ts';
import { signetsFor } from './signetbook.ts';
import { gateOpen } from './signet.ts';
import { dispositionOf } from '../character/persona.ts';
import { equip, unequip } from '../items/types.ts';
import type { Slot } from '../items/types.ts';
import { allocate } from './allocate.ts';
import { hpAfterGrowth, spendAbilityPoint } from './progress.ts';
import { skillTreeFor } from './skilltree.ts';
import type { PlayState } from './state.ts';
import { awardTraits } from './traits.ts';
import type { TraitContext } from './traits.ts';
import { traitOriginOf, traitsFor } from './traitbook.ts';
import { useItem } from './rest.ts';
import { canChooseSubclassOf, subclassOf, subclassSkill, SUBCLASS_LEVEL } from '../character/classes.ts';

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
  /** Stow something in a bag, or take it back out into your hands. */
  | { type: 'stow'; item: string; container: string }
  | { type: 'takeOut'; item: string }
  /** Take a piece off a thing, or put a loose piece back on one. */
  | { type: 'strip'; item: string; part: string }
  | { type: 'fit'; item: string; part: string }
  /**
   * The three ways a thing gets better, and the trade between them.
   *
   * Enhancing RESETS refining and working, which is what makes when to enhance
   * a decision rather than one more upgrade taken the moment it is affordable.
   */
  | { type: 'refine'; item: string }
  | { type: 'enchant'; item: string; working: string }
  | { type: 'enhance'; item: string }
  /** Put right the piece that failed. Never quite all the way. */
  | { type: 'repair'; item: string }
  | { type: 'use'; item: string }
  /** Taken once, at level three. It reshapes the tree by opening an island. */
  | { type: 'chooseSubclass'; id: string }
  /**
   * Read what a thing has to tell you.
   *
   * The action that makes lore a mechanic rather than decoration: a history
   * touching what you are climbing FOR meets `purpose`, and one about what you
   * are running from still counts. Once only — a paragraph cannot be re-read
   * for the same comfort — and what it leaves behind is knowledge you can tell
   * somebody else.
   */
  | { type: 'read'; item: string }
  /**
   * Claim a Signet whose gate has opened.
   *
   * The last step of a system that was otherwise complete: Signets were
   * generated, proved reachable, filtered for visibility and rendered with a
   * "within reach" tag — and `CharacterSheet.signets` was written by NO code
   * path, so none of them could ever be acquired. `SignetView.available` has
   * said "the gate is open and it can be claimed" the whole time.
   */
  | { type: 'claimSignet'; id: string };

/** The log entry. Mirrors TurnRecord's shape so the fold can tell them apart. */
export type SheetRecord = { kind: 'sheet'; action: SheetAction };

export const sheetRecord = (action: SheetAction): SheetRecord => ({ kind: 'sheet', action });

export type SheetResult = { state: PlayState; error: string | null; note: string | null };

export const treeFor = (state: PlayState) =>
  skillTreeFor(state.world.seed, state.sheet.background.id, state.sheet.language, state.sheet.background.name, {
    classId: state.sheet.classId,
    subclassId: state.sheet.subclassId,
    level: state.sheet.level,
    // Everything the character earned rather than was given. Each may have
    // grown a branch, and the tree is rebuilt from them every time.
    traits: state.sheet.traits,
    signets: state.sheet.signets,
    books: state.sheet.library,
  });

export const contextOf = (state: PlayState): TraitContext => ({
  sheet: state.sheet,
  inventory: state.pc.inventory,
  counters: state.sheet.counters,
  personality: dispositionOf(state.sheet),
});

/**
 * Apply one panel action.
 *
 * Deterministic and model-free, so replaying the log reproduces the same sheet.
 * Every branch re-derives hit points afterwards, because a point in
 * constitution, a tree node and a suit of armour can all move the maximum.
 */
/**
 * The shared half of refining, working and enhancing.
 *
 * All three cost coin, name one object, and either change it or explain why
 * not. COIN FINALLY HAS A SPENDER — it has been earned from every fight and
 * spent on nothing at all since it was added.
 */
function improve(
  state: PlayState,
  itemId: string,
  attempt: (inst: ItemInstance, rules: Ruleset) => Attempt,
  priceOf: (inst: ItemInstance) => number,
): SheetResult {
  const holding = findHolding(state.pc.inventory, itemId);
  if (!holding) return { state, error: 'you are not carrying that', note: null };

  const price = priceOf(holding.instance);
  if (state.pc.coin < price) return { state, error: `that would cost ${price}`, note: null };

  const tried = attempt(holding.instance, rulesOf(state.world));
  // A refusal is free. Nothing was tried, so nothing is owed.
  if (!tried.attempted) return { state, error: tried.note, note: null };

  /*
   * A FAILURE STILL COSTS. The fee is for the attempt, not the outcome, which
   * is the only thing that makes risk mean anything — and when a thing comes
   * apart it is GONE, rather than quietly surviving because the outcome had no
   * object in it.
   */
  const inventory = tried.item
    ? withInstance(state.pc.inventory, holding.instance.id, tried.item)
    : removeItem(state.pc.inventory, holding.instance.id);

  return settle(
    { ...state, pc: { ...state.pc, coin: state.pc.coin - price, inventory } },
    state,
    tried.note,
  );
}

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
      const worn = equip(state.pc.inventory, action.item, rulesOf(state.world));
      if (worn.error) return { state, error: worn.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: worn.inventory } }, state, 'equipped');
    }

    case 'stow': {
      const stowed = putIn(state.pc.inventory, action.item, action.container, rulesOf(state.world));
      if (stowed.error) return { state, error: stowed.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: stowed.inventory } }, state, 'packed');
    }

    case 'takeOut': {
      const out = takeOut(state.pc.inventory, action.item);
      if (out.error) return { state, error: out.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: out.inventory } }, state, 'unpacked');
    }

    case 'strip': {
      const off = detachPart(state.pc.inventory, action.item, action.part);
      if (off.error) return { state, error: off.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: off.inventory } }, state, 'taken apart');
    }

    case 'fit': {
      // Where it goes is the engine's business, not the player's: a piece has
      // one place on a thing, and asking somebody to pick a square for a
      // crossguard would be a worse game.
      const on = attachPart(state.pc.inventory, action.item, action.part, { x: 0, y: 0 });
      if (on.error) return { state, error: on.error, note: null };
      return settle({ ...state, pc: { ...state.pc, inventory: on.inventory } }, state, 'fitted');
    }

    case 'refine':
      return improve(state, action.item, (inst, rules) => refine(inst, rules.gear), (inst) => refineCost(inst.refine ?? 0));

    case 'enchant':
      return improve(state, action.item, (inst) => enchant(inst, action.working), (inst) => enchantCost(inst.enchants?.length ?? 0));

    case 'enhance':
      return improve(state, action.item, (inst) => enhance(inst), (inst) => enhanceCost(inst.rarity));

    case 'repair':
      return improve(
        state,
        action.item,
        (inst, rules) => repair(inst, rules.gear.repairLoss),
        (inst) => repairCost(inst, findHolding(state.pc.inventory, action.item)?.item.value ?? 20,
          rulesOf(state.world).gear.repairLoss),
      );

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

    case 'read': {
      const found = findItem(state.pc.inventory, action.item);
      if (!found) return { state, error: 'you are not carrying that', note: null };

      const lore = loreFor(found, state.world, state.sheet.language);
      if (!lore) return { state, error: 'there is nothing to it', note: null };
      if (knowsLore(state.sheet, lore.id)) return { state, error: 'you have read it', note: null };

      const heard = learn(state.sheet, lore);
      return settle(
        { ...state, sheet: heard.who },
        state,
        heard.resonance.hit ? lore.text : 'you read it, and it is not about you',
      );
    }

    case 'claimSignet': {
      const held = state.sheet.signets ?? [];
      if (held.includes(action.id)) return { state, error: 'already yours', note: null };

      const world = { flags: state.world.flags, deepestFloor: state.world.deepestFloor };
      const signet = signetsFor(state).kept.find((s) => s.id === action.id);
      if (!signet) return { state, error: 'no such signet', note: null };

      // The gate is re-checked here rather than trusted from the view, because
      // the view is a suggestion and this is the boundary.
      if (!gateOpen(signet.gate, contextOf(state), world)) {
        return { state, error: 'it is not within reach yet', note: null };
      }

      return settle(
        { ...state, sheet: { ...state.sheet, signets: [...held, signet.id] } },
        state,
        `${signet.name} claimed`,
      );
    }

    case 'chooseSubclass': {
      const sheet = state.sheet;
      if (!canChooseSubclassOf(sheet.level, sheet)) {
        return {
          state,
          error: sheet.subclassId ? 'you have already chosen' : `not until level ${SUBCLASS_LEVEL}`,
          note: null,
        };
      }

      const sub = subclassOf({ ...sheet, subclassId: action.id });
      if (!sub) return { state, error: 'no such path', note: null };

      // The signature skill is granted outright; the island it opens appears
      // because the tree is regenerated from the subclass id.
      const taught = subclassSkill(sub, sheet.language);
      const learned = (sheet.learned ?? []).some((s) => s.id === taught.id)
        ? (sheet.learned ?? [])
        : [...(sheet.learned ?? []), taught];

      return settle(
        { ...state, sheet: { ...sheet, subclassId: sub.id, learned } },
        state,
        `${sub.name[sheet.language]} — ${taught.name}`,
      );
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
  const awarded = awardTraits(traitsFor(next.world.seed, traitOriginOf(next)), next.sheet, next.pc.inventory);

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
