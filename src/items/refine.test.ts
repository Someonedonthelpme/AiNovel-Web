import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionOfInstance, instanceOf, PRISTINE, RARITIES, walk } from './instance.ts';
import type { ItemInstance } from './instance.ts';
import {
  bonusOf, canEnchant, enchant, ENCHANT_EVERY, enhance, milestonesAt,
  nextRarity, refine, refineBonus, repair, repairCost, stepOf,
} from './refine.ts';
import type { RefineRules } from './refine.ts';
import { STANDARD } from '../rules/ruleset.ts';
import { addItem, emptyInventory, equip, equippedArmour, equippedAttack, equippedGrants, withInstance } from './types.ts';
import type { Item } from './types.ts';
import { applySheetAction } from '../play/sheetaction.ts';
import { playState } from '../play/fixtures.ts';

const thing = (id = 'a') => instanceOf(id, 'w');
const never: RefineRules = { maxRefine: 10, refineRisk: 0, refineLoss: 1 };
const always: RefineRules = { maxRefine: 10, refineRisk: 1, refineLoss: 1 };

/* -------------------------------------------------------------------------- */
/* Refine                                                                      */
/* -------------------------------------------------------------------------- */

test('a level is worth SOMETHING, and the same something every time it is asked', () => {
  // A refine that came out differently on replay would break the fold.
  assert.deepEqual(stepOf('axe', 3), stepOf('axe', 3));
  assert.notDeepEqual(refineBonus('axe', 0), refineBonus('axe', 4));
});

test('two objects of the same kind refine DIFFERENTLY', () => {
  // The RO reading: what a level is worth belongs to the object, not the type,
  // which is what makes a particular +7 blade a particular thing.
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => JSON.stringify(refineBonus(id, 5)));
  assert.ok(new Set(many).size > 1, 'every object refined identically');
});

test('levels accumulate', () => {
  const four = refineBonus('axe', 4);
  const worth = (b: typeof four) => b.armour + Object.values(b.ability).reduce((n, v) => n + (v ?? 0), 0);
  assert.equal(worth(four), 4, 'four levels, four points of something');
});

test('it stops at the ceiling, and being refused is FREE', () => {
  const maxed = { ...thing(), refine: 10 };
  const tried = refine(maxed, never);
  assert.equal(tried.attempted, false, 'nothing was tried');
  assert.equal(tried.item, maxed, 'and nothing changed');
});

test('failing is not the same as being refused', () => {
  /*
   * Three things that `item === null` alone could not tell apart: a refusal
   * costs nothing, a failure costs the fee and may leave the thing worse, and
   * destruction leaves no thing at all.
   */
  const at3 = { ...thing(), refine: 3 };
  const failed = refine(at3, always);
  assert.equal(failed.attempted, true, 'it happened');
  assert.equal(failed.item?.refine, 2, 'and it cost a level');
});

test('a loss past the ceiling destroys it outright', () => {
  const gone = refine({ ...thing(), refine: 3 }, { ...always, refineLoss: 99 });
  assert.equal(gone.attempted, true);
  assert.equal(gone.item, null);
});

test('the same object refines the same way on a replay', () => {
  const at2 = { ...thing(), refine: 2, tries: 5 };
  assert.deepEqual(refine(at2, STANDARD.gear), refine(at2, STANDARD.gear));
});

test('A LEVEL THAT FAILED ONCE CAN STILL BE PASSED', () => {
  /*
   * Found by running it rather than by a test: seeding the roll on the LEVEL
   * gave the same input the same answer for ever, so an object sat at +2
   * through two dozen attempts and every coin spent on it. Each attempt is its
   * own roll now, and the replay stays exact because the count is stored.
   */
  let inst = thing();
  for (let n = 0; n < 40 && inst; n++) {
    const tried = refine(inst, STANDARD.gear);
    if (!tried.item) break;
    inst = tried.item;
  }
  assert.ok((inst?.refine ?? 0) > 4, `stuck at +${inst?.refine ?? 0} after forty attempts`);
});

test('and every attempt is counted, whether it took or not', () => {
  const once = refine(thing(), { ...STANDARD.gear, refineRisk: 1 }).item;
  assert.equal(once?.tries, 1, 'a failure is still a visit to the smith');
});

/* -------------------------------------------------------------------------- */
/* Enchant                                                                     */
/* -------------------------------------------------------------------------- */

test('a working is earned at a milestone, not bought whenever', () => {
  assert.equal(canEnchant({ ...thing(), refine: ENCHANT_EVERY - 1 }), false);
  assert.equal(canEnchant({ ...thing(), refine: ENCHANT_EVERY }), true);
  assert.equal(milestonesAt(ENCHANT_EVERY * 2), 2);
});

test('one milestone buys one working', () => {
  const earned = { ...thing(), refine: ENCHANT_EVERY };
  const once = enchant(earned, 'keen');
  assert.equal(once.attempted, true);
  assert.equal(enchant(once.item!, 'heavy').attempted, false, 'the second needs another milestone');
});

test('and never the same one twice, nor one that does not exist', () => {
  const worked = { ...thing(), refine: ENCHANT_EVERY, enchants: ['keen'] };
  assert.equal(enchant(worked, 'keen').attempted, false);
  assert.equal(enchant({ ...thing(), refine: 99 }, 'nonsense').attempted, false);
});

/* -------------------------------------------------------------------------- */
/* Enhance — the trade                                                         */
/* -------------------------------------------------------------------------- */

test('ENHANCING RESETS EVERYTHING PUT IN, which is the whole design', () => {
  /*
   * The reset is not a penalty bolted on to make enhancing costly. It is what
   * makes WHEN to enhance a decision: a +9 blade with two workings on it is a
   * real thing to give up, and whether the rarity is worth more than what you
   * already have is the only interesting question an upgrade path can ask.
   */
  const invested = { ...thing(), refine: 9, enchants: ['keen', 'heavy'] };
  const reborn = enhance(invested);

  assert.equal(reborn.item?.rarity, 'uncommon');
  assert.equal(reborn.item?.refine, 0);
  assert.deepEqual(reborn.item?.enchants, []);
});

test('rebirth is not repair: wear survives it', () => {
  const battered = { ...thing(), condition: 40, refine: 4 };
  assert.equal(enhance(battered).item?.condition, 40);
});

test('a rarity is worth something, and the same something after a reset', () => {
  // Otherwise enhancing would be a way to re-roll a disappointing refine, and
  // nobody would ever keep a bad one.
  const once = enhance(thing()).item!;
  const again = enhance({ ...thing(), refine: 7 }).item!;
  assert.deepEqual(bonusOf(once), bonusOf(again));
});

test('it tops out, and the top is a refusal rather than a silent no-op', () => {
  const finest = { ...thing(), rarity: RARITIES[RARITIES.length - 1] };
  assert.equal(nextRarity(finest.rarity), null);
  assert.equal(enhance(finest).attempted, false);
});

/* -------------------------------------------------------------------------- */
/* One reader for all three                                                    */
/* -------------------------------------------------------------------------- */

const mail: Item = {
  id: 'a_mail', name: 'mail', description: '', kind: 'equipment', slot: 'body',
  armour: 15, stackable: false, value: 1,
};

test('REFINED ARMOUR IS BETTER ARMOUR', () => {
  let inv = equip(addItem(emptyInventory(), mail), mail.id).inventory;
  const id = inv.held[0].instance.id;
  const plain = equippedArmour(inv)!;

  // Refine it until a level that thickens it has come up.
  for (let level = 1; level <= 6; level++) {
    inv = withInstance(inv, id, { ...inv.held[0].instance, refine: level });
    if (equippedArmour(inv)! > plain) return;
  }
  assert.fail('six levels of refining did nothing to the armour');
});

test('a working shows up in what you are worth', () => {
  let inv = equip(addItem(emptyInventory(), mail), mail.id).inventory;
  const id = inv.held[0].instance.id;
  const before = equippedGrants(inv).str ?? 0;

  inv = withInstance(inv, id, { ...inv.held[0].instance, enchants: ['heavy'] });
  assert.equal(equippedGrants(inv).str ?? 0, before + 1);
});

/* -------------------------------------------------------------------------- */
/* And COIN finally has a spender                                              */
/* -------------------------------------------------------------------------- */

test('COIN IS SPENT, having been earned and spent on nothing since it existed', () => {
  const base = playState();
  const id = base.pc.inventory.held[0].instance.id;
  const rich = { ...base, pc: { ...base.pc, coin: 500 } };

  const done = applySheetAction(rich, { type: 'refine', item: id });
  assert.equal(done.error, null, done.error ?? '');
  assert.ok(done.state.pc.coin < 500, 'it cost something');
});

test('what you cannot afford is refused, and costs nothing', () => {
  const base = playState();
  const id = base.pc.inventory.held[0].instance.id;
  const broke = { ...base, pc: { ...base.pc, coin: 0 } };

  const tried = applySheetAction(broke, { type: 'refine', item: id });
  assert.match(tried.error ?? '', /would cost/);
  assert.equal(tried.state.pc.coin, 0);
});

test('a FAILURE still costs, because the fee is for the attempt', () => {
  const base = playState();
  const id = base.pc.inventory.held[0].instance.id;
  const doomed = {
    ...base,
    pc: { ...base.pc, coin: 500 },
    world: { ...base.world, rules: { ...STANDARD, gear: { ...STANDARD.gear, refineRisk: 1, refineLoss: 99 } } },
  };

  const gone = applySheetAction(doomed, { type: 'refine', item: id });
  assert.equal(gone.error, null);
  assert.ok(gone.state.pc.coin < 500, 'the fee is gone');
  // And so is the thing — a destroyed object must not quietly survive.
  assert.equal(gone.state.pc.inventory.held.some((h) => h.instance.id === id), false);
});

test('refining is FOLDED, so a replayed session lands on the same levels', () => {
  const base = { ...playState() };
  const rich = { ...base, pc: { ...base.pc, coin: 500 } };
  const id = rich.pc.inventory.held[0].instance.id;
  const once = applySheetAction(rich, { type: 'refine', item: id }).state.pc.inventory;
  const twice = applySheetAction(rich, { type: 'refine', item: id }).state.pc.inventory;
  assert.deepEqual(once, twice);
});

/* -------------------------------------------------------------------------- */
/* Repair — mending the piece, and never quite all the way                     */
/* -------------------------------------------------------------------------- */

const worn = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  ...instanceOf('sword', 'w'),
  parts: [
    { at: { x: 0, y: 0 }, item: { ...instanceOf('sword/0', 'head_blade'), condition: 90 } },
    { at: { x: 0, y: 2 }, item: { ...instanceOf('sword/1', 'grip'), condition: 20 } },
  ],
  ...over,
});

test('IT MENDS THE PIECE THAT FAILED, not the thing', () => {
  /*
   * `weakestPart` has said since it was written that this is what it is for,
   * and nothing ever called it. A handle that has failed on a blade still true
   * is a different object from a worn-out sword, and only one of them is worth
   * carrying to a smith.
   */
  const fixed = repair(worn(), 0).item!;
  const pieces = walk(fixed).slice(1);

  assert.equal(pieces.find((p) => p.typeId === 'grip')?.condition, PRISTINE, 'the grip is put right');
  assert.equal(pieces.find((p) => p.typeId === 'head_blade')?.condition, 90, 'the blade is left alone');
});

test('A MENDING NEVER QUITE GETS IT BACK', () => {
  /*
   * Without this, repair is "pay coin, it is new again" for ever and no blade
   * is ever replaced.
   *
   * One piece, and it is broken down again between mendings — otherwise the
   * OTHER piece is the weakest and gets the smith's attention instead, which is
   * correct behaviour and tests nothing about ceilings.
   */
  let inst: ItemInstance = {
    ...instanceOf('sword', 'w'),
    parts: [{ at: { x: 0, y: 0 }, item: { ...instanceOf('sword/0', 'grip'), condition: 5 } }],
  };

  const reached: number[] = [];
  for (let n = 0; n < 4; n++) {
    inst = repair(inst, 8).item!;
    reached.push(conditionOfInstance(inst));
    inst = { ...inst, parts: inst.parts!.map((p) => ({ ...p, item: { ...p.item, condition: 5 } })) };
  }

  assert.equal(reached[0], PRISTINE, 'the first mending is a full one');
  assert.ok(reached[3] < reached[0], `mendings gave back ${reached.join(' then ')}`);
});

test('but a thing never becomes nothing while you are still carrying it', () => {
  // Worn past use should mean unreliable, not vanished.
  const ancient = { ...instanceOf('a', 'w'), condition: 0, repairs: 99 };
  assert.ok((repair(ancient, 20).item?.condition ?? 0) > 0);
});

test('a smith who can do nothing more says so, and it is free', () => {
  const fine = { ...instanceOf('a', 'w'), condition: PRISTINE };
  const tried = repair(fine, 8);
  assert.equal(tried.attempted, false);
  assert.equal(tried.item, fine);
});

test('what it costs follows how far gone it is', () => {
  const bad = { ...instanceOf('a', 'w'), condition: 5 };
  const nearly = { ...instanceOf('a', 'w'), condition: 90 };
  assert.ok(repairCost(bad, 100, 0) > repairCost(nearly, 100, 0));
});

test('a repaired weapon works again', () => {
  // The reader that matters: `equippedAttack` refuses a broken thing, so a
  // mending has to be what puts it back in your hand.
  const blade: Item = {
    id: 'w_blade', name: 'sword', description: '', kind: 'equipment', slot: 'main',
    stackable: false, value: 5,
    attack: { id: 'atk', name: 'sword', ability: 'str', proficient: true, range: 1,
              damage: { count: 1, sides: 6, bonusAbility: 'str', type: 'slashing' } },
  };
  let inv = equip(addItem(emptyInventory(), blade), blade.id).inventory;
  const id = inv.held[0].instance.id;

  inv = withInstance(inv, id, { ...inv.held[0].instance, condition: 0 });
  assert.equal(equippedAttack(inv), null, 'a weapon worn through is an empty hand');

  inv = withInstance(inv, id, repair(inv.held[0].instance, 8).item!);
  assert.ok(equippedAttack(inv), 'and a mended one is a weapon again');
});

test('mending is FOLDED, and costs coin like everything else at a smith', () => {
  const base = playState();
  const id = base.pc.inventory.held[0].instance.id;
  const battered = {
    ...base,
    pc: {
      ...base.pc,
      coin: 500,
      inventory: withInstance(base.pc.inventory, id, {
        ...base.pc.inventory.held[0].instance, condition: 10,
      }),
    },
  };

  const done = applySheetAction(battered, { type: 'repair', item: id });
  assert.equal(done.error, null, done.error ?? '');
  assert.ok(done.state.pc.coin < 500, 'a smith is not free');
  assert.deepEqual(done.state, applySheetAction(battered, { type: 'repair', item: id }).state);
});
