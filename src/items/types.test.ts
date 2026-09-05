import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, countOf, emptyInventory, equip, equippedArmour, equippedAttack,
  equippedGrants, isEquipped, removeItem, unequip, conditionIn, wearEquipped,
  carriedWeight, findHolding, isContainer, putIn, spaceIn, takeOut, boardOf,
} from './types.ts';
import type { Inventory, Item } from './types.ts';
import { rations, weapon, armour, pack, namesTheSameThing, stripMechanics, weaponFromAttack } from './catalogue.ts';
import { carryCapacityFor } from '../session/sheet.ts';
import { sword } from '../combat/fixtures.ts';
import { startingInventory } from '../play/state.ts';
import { sheet } from '../session/fixtures.ts';
import { mulberry32 } from '../engine/roll.ts';
import { PRISTINE } from './instance.ts';

const ring: Item = {
  id: 'ring_of_note', name: 'a plain ring', description: '',
  kind: 'equipment', slot: 'ring', grants: { int: 2 }, stackable: false, value: 10,
};

test('stackable things collapse into one line', () => {
  const food = rations(2);
  let inv = addItem(emptyInventory(), food.item, food.count);
  inv = addItem(inv, food.item, 3);
  assert.equal(inv.stacks.length, 1);
  assert.equal(countOf(inv, food.item.id), 5);
});

test('unstackable things become INSTANCES, so provenance survives', () => {
  // Two swords from different floors are two swords, and now they are two
  // OBJECTS — which is what lets one of them be notched and the other not.
  const rng = mulberry32(1);
  let inv = addItem(emptyInventory(), weapon(rng, 3));
  inv = addItem(inv, weapon(mulberry32(99), 12));
  assert.equal(inv.held.length, 2);
  assert.equal(inv.stacks.length, 0, 'and neither of them is a stack');
});

test('two of the SAME thing are still two objects, with ids of their own', () => {
  const rng = mulberry32(1);
  const sword = weapon(rng, 3);
  const inv = addItem(addItem(emptyInventory(), sword), sword);

  assert.equal(inv.held.length, 2);
  assert.equal(new Set(inv.held.map((h) => h.instance.id)).size, 2, 'and they are distinguishable');
});

test('an id is never reused while the thing holding it is still here', () => {
  // Deterministic, because the fold replays — but the SMALLEST free suffix
  // rather than a count, or dropping the first of two and picking up another
  // would mint a second object with the survivor's id.
  const rng = mulberry32(1);
  const sword = weapon(rng, 3);
  let inv = addItem(addItem(emptyInventory(), sword), sword);
  const second = inv.held[1].instance.id;

  inv = addItem(removeItem(inv, inv.held[0].instance.id), sword);
  assert.equal(new Set(inv.held.map((h) => h.instance.id)).size, 2, `${second} was minted twice`);
});

test('equipping wields a SPECIFIC object, not a kind of one', () => {
  const rng = mulberry32(1);
  const sword = weapon(rng, 3);
  const inv = equip(addItem(addItem(emptyInventory(), sword), sword), sword.id).inventory;

  assert.equal(inv.equipped.main, inv.held[0].instance.id);
  assert.equal(isEquipped(inv, sword.id), true, 'and the kind still reads as worn');
});

test('taking the last of something unequips it', () => {
  // Otherwise the character wields what they no longer own, and the attack
  // silently falls back — a bug that reads as bad luck.
  let inv = addItem(emptyInventory(), ring);
  inv = equip(inv, ring.id).inventory;
  assert.equal(isEquipped(inv, ring.id), true);

  inv = removeItem(inv, ring.id, 1);
  assert.equal(isEquipped(inv, ring.id), false);
  assert.equal(inv.stacks.length, 0);
});

test('you cannot wear what you are not carrying', () => {
  assert.match(equip(emptyInventory(), ring.id).error ?? '', /not carrying/);
});

test('you cannot wield a ration', () => {
  const food = rations(1);
  const inv = addItem(emptyInventory(), food.item, 1);
  assert.match(equip(inv, food.item.id).error ?? '', /not something you can wear or wield/);
});

test('what is worn is what counts', () => {
  const suit = armour(mulberry32(4), 1);
  let inv = addItem(addItem(emptyInventory(), suit), ring);

  assert.equal(equippedArmour(inv), null, 'carrying is not wearing');
  assert.deepEqual(equippedGrants(inv), {});

  inv = equip(inv, suit.id).inventory;
  inv = equip(inv, ring.id).inventory;

  assert.equal(equippedArmour(inv), suit.armour);
  assert.equal(equippedGrants(inv).int, 2);
});

test('a wielded weapon offers its attack', () => {
  const blade = weapon(mulberry32(7), 6);
  let inv = addItem(emptyInventory(), blade);
  assert.equal(equippedAttack(inv), null);
  inv = equip(inv, blade.id).inventory;
  assert.equal(equippedAttack(inv)?.id, blade.attack?.id);
});

test('taking off a slot leaves the item in the pack', () => {
  let inv = equip(addItem(emptyInventory(), ring), ring.id).inventory;
  inv = unequip(inv, 'ring_l');
  assert.equal(isEquipped(inv, ring.id), false);
  assert.equal(countOf(inv, ring.id), 1, 'you still own it');
});

test('deeper floors give better weapons, and the die never runs away', () => {
  const shallow = weapon(mulberry32(3), 1).attack!.damage.sides;
  const deep = weapon(mulberry32(3), 20).attack!.damage.sides;
  assert.ok(deep > shallow, 'depth should be worth something');
  assert.ok(deep <= 12, 'and the die tops out at d12');
});

test('loot carries the floor it came from, because Signets gate on it', () => {
  const found = weapon(mulberry32(5), 9);
  assert.equal(found.foundOn, 9);
});

/* -------------------------------------------------------------------------- */
/* Starting gear                                                               */
/* -------------------------------------------------------------------------- */

test('a description does not get to invent its own numbers', () => {
  // The model writes "Damage: 1d6 + Strength modifier. Weight: 3 lbs." next to
  // numbers the engine actually holds. When the two disagree, the description
  // is lying to the player.
  const cleaned = stripMechanics('A short, sturdy spear. Range: 1. Damage: 1d6 + Strength modifier. Weight: 3 lbs.');
  assert.match(cleaned, /short, sturdy spear/);
  assert.equal(/damage|weight|range/i.test(cleaned), false);
});

test('the starting weapon carries the attack the background declares', () => {
  // Not name-matching guesswork: the numbers are the ones combat was always
  // going to use.
  const made = weaponFromAttack(sword);
  assert.equal(made.kind, 'equipment');
  assert.equal(made.slot, 'main');
  assert.deepEqual(made.attack, sword);
});

test('the model keeps the prose, the engine keeps the arithmetic', () => {
  const made = weaponFromAttack(sword, { name: 'Short Spear', description: 'Worn smooth. Damage: 4d12.' });
  assert.equal(made.name, 'Short Spear');
  assert.match(made.description, /Worn smooth/);
  assert.equal(/4d12/.test(made.description), false, 'the invented damage does not survive');
  assert.deepEqual(made.attack, sword, 'and the real attack is unchanged');
});

test('the same thing named twice is issued once', () => {
  assert.equal(namesTheSameThing('Short Spear', 'spear'), true);
  assert.equal(namesTheSameThing('Waterproof Satchel', 'spear'), false);
  assert.equal(namesTheSameThing('a rope', 'shortsword'), false, 'short words do not count as a match');
});

test('a character starts with a weapon in hand, not a souvenir', () => {
  // Regression: the pack held an inert "Short Spear" while the attack came from
  // somewhere the player could not see.
  const inv = startingInventory(sheet());
  const wielded = equippedAttack(inv);
  assert.ok(wielded, 'something should be equipped');
  assert.equal(inv.held.filter((h) => h.item.slot === 'main').length, 1, 'and only one of it');
});

/* -------------------------------------------------------------------------- */
/* Wear — the reason instances exist at all                                    */
/* -------------------------------------------------------------------------- */

const blade: Item = {
  id: 'w_blade', name: 'a plain sword', description: '', kind: 'equipment', slot: 'main',
  stackable: false, value: 5,
  attack: { id: 'atk', name: 'sword', ability: 'str', proficient: true, range: 1,
            damage: { count: 1, sides: 6, bonusAbility: 'str', type: 'slashing' } },
};

const mail: Item = {
  id: 'a_mail', name: 'mail', description: '', kind: 'equipment', slot: 'body',
  stackable: false, value: 5, armour: 15,
};

test('two of the same thing wear SEPARATELY, which stacking could never say', () => {
  /*
   * The model change the whole rework turns on. Two axes at different wear are
   * not one object with a count of two, and no amount of care with a count
   * could ever make them one.
   */
  let inv = addItem(addItem(emptyInventory(), blade), blade);
  const [first, second] = inv.held.map((h) => h.instance.id);

  inv = equip(inv, first).inventory;
  inv = wearEquipped(inv, 30);

  assert.ok(conditionIn(inv, first) < 1, 'the one in your hand is worn');
  assert.equal(conditionIn(inv, second), 1, 'the one in your pack is not');
});

test('a weapon worn through is no better than an empty hand', () => {
  // Broken rather than degraded: a blade doing nine tenths of its damage is a
  // number nobody can feel, and one that has failed is a decision.
  let inv = equip(addItem(emptyInventory(), blade), blade.id).inventory;
  assert.ok(equippedAttack(inv), 'it works to begin with');

  inv = wearEquipped(inv, PRISTINE);
  assert.equal(equippedAttack(inv), null);
});

test('armour worn through stops being armour', () => {
  let inv = equip(addItem(emptyInventory(), mail), mail.id).inventory;
  assert.equal(equippedArmour(inv), 15);
  assert.equal(equippedArmour(wearEquipped(inv, PRISTINE)), null);
});

test('nothing in the pack wears — only what you are actually using', () => {
  const inv = wearEquipped(addItem(emptyInventory(), blade), 50);
  assert.equal(conditionIn(inv, blade.id), 1);
});

test('a stack has no condition to speak of, and reads as whole', () => {
  const inv = addItem(emptyInventory(), { ...blade, id: 'r', stackable: true, kind: 'consumable' }, 3);
  assert.equal(conditionIn(inv, 'r'), 1);
});

/* -------------------------------------------------------------------------- */
/* Containers — capacity becomes a thing you own                               */
/* -------------------------------------------------------------------------- */

const bag = (id: string, capacity: number): Item => ({
  id, name: 'a bag', description: '', kind: 'equipment', slot: 'back',
  capacity, weight: 2, stackable: false, value: 1,
});

const brick = (id: string, weight: number): Item => ({
  id, name: 'a brick', description: '', kind: 'material', weight, stackable: false, value: 1,
});

const first = (inv: Inventory, typeId: string) =>
  inv.held.find((h) => h.item.id === typeId)!.instance.id;

test('CAPACITY BECOMES SOMETHING YOU OWN, not a fact about your body', () => {
  /*
   * It used to be `carryBase + STR` and nothing else, so a pack was not a thing
   * you could find, fill or lose. This is the whole point of containers: the
   * first good bag is loot worth having.
   */
  const bare = sheet();
  const withBag = equip(addItem(emptyInventory(), bag('b', 20)), 'b').inventory;

  assert.ok(carryCapacityFor(bare, withBag) > carryCapacityFor(bare, emptyInventory()));
});

test('and losing it costs you the room', () => {
  const who = sheet();
  const packed = equip(addItem(emptyInventory(), bag('b', 20)), 'b').inventory;
  const dropped = removeItem(packed, first(packed, 'b'));
  assert.equal(carryCapacityFor(who, dropped), carryCapacityFor(who, emptyInventory()));
});

test('a bag holds things, and they go in and come back out', () => {
  let inv = addItem(addItem(emptyInventory(), bag('b', 20)), brick('r', 3));
  const bagId = first(inv, 'b');
  const rock = first(inv, 'r');

  const stowed = putIn(inv, rock, bagId);
  assert.equal(stowed.error, null);
  assert.equal(stowed.inventory.held.length, 1, 'only the bag is in your hands now');
  assert.equal(findHolding(stowed.inventory, rock)?.item.id, 'r', 'but the rock is still yours');

  const out = takeOut(stowed.inventory, rock);
  assert.equal(out.error, null);
  assert.equal(out.inventory.held.length, 2);
});

test('CONTAINERS BUY SPACE, NEVER WEIGHTLESSNESS', () => {
  // A bag that made its contents free would make carrying a decision about
  // bags rather than about what you are carrying.
  let inv = addItem(addItem(emptyInventory(), bag('b', 20)), brick('r', 3));
  const before = carriedWeight(inv);
  const stowed = putIn(inv, first(inv, 'r'), first(inv, 'b')).inventory;

  assert.equal(carriedWeight(stowed), before, 'a full pack weighs what a full pack weighs');
});

test('what will not fit is refused, and says so', () => {
  const inv = addItem(addItem(emptyInventory(), bag('b', 2)), brick('r', 9));
  const tried = putIn(inv, first(inv, 'r'), first(inv, 'b'));
  assert.match(tried.error ?? '', /will not fit/);
  assert.deepEqual(tried.inventory, inv, 'and nothing moved');
});

test('A BAG INSIDE A BAG, but never inside itself', () => {
  let inv = addItem(addItem(emptyInventory(), bag('big', 30)), bag('small', 6));
  const big = first(inv, 'big');
  const small = first(inv, 'small');

  const nested = putIn(inv, small, big);
  assert.equal(nested.error, null, 'a bag inside a bag is fine');

  assert.match(putIn(nested.inventory, big, big).error ?? '', /inside itself/);
  // And not inside one of its own pockets, which is the same cycle a step out.
  assert.match(putIn(nested.inventory, big, small).error ?? '', /inside itself/);
});

test('something in a bag inside a bag is still findable, and still weighs', () => {
  let inv = addItem(addItem(addItem(emptyInventory(), bag('big', 30)), bag('small', 10)), brick('r', 3));
  const before = carriedWeight(inv);

  inv = putIn(inv, first(inv, 'r'), first(inv, 'small')).inventory;
  inv = putIn(inv, first(inv, 'small'), first(inv, 'big')).inventory;

  assert.equal(inv.held.length, 1, 'one bag in your hands');
  assert.ok(findHolding(inv, 'r'), 'and the rock two layers down is still yours');
  assert.equal(carriedWeight(inv), before);
});

test('you cannot stow what you are wearing without taking it off', () => {
  let inv = addItem(addItem(emptyInventory(), bag('b', 20)), blade);
  inv = equip(inv, blade.id).inventory;
  assert.match(putIn(inv, first(inv, blade.id), first(inv, 'b')).error ?? '', /take .* off first/);
});

test('a bag that fills up stops having room', () => {
  let inv = addItem(addItem(emptyInventory(), bag('b', 4)), brick('r', 3));
  const bagId = first(inv, 'b');
  inv = putIn(inv, first(inv, 'r'), bagId).inventory;

  assert.equal(spaceIn(findHolding(inv, bagId)!), 1);
  assert.equal(isContainer(bag('b', 4)), true);
  assert.equal(isContainer(brick('r', 3)), false);
});

/* -------------------------------------------------------------------------- */
/* The board — space, not just weight                                          */
/* -------------------------------------------------------------------------- */

const boarded = (id: string, grid: string, capacity?: number): Item => ({
  id, name: 'a case', description: '', kind: 'equipment', slot: 'back',
  grid, capacity, weight: 2, stackable: false, value: 1,
});

const shaped = (id: string, shape: string): Item =>
  ({ id, name: 'a thing', description: '', kind: 'material', shape, weight: 1, stackable: false, value: 1 });

test('TWO MODELS, ONE CODE PATH: weight, board, both, or neither', () => {
  /*
   * The ruleset principle applied to bags. A container with only a capacity is
   * the weight model; one with only a grid is the slot model; one with both is
   * checked against both. No branch anywhere asks which kind of game this is.
   */
  const heavy = shaped('h', 'x');
  const byWeight = addItem(addItem(emptyInventory(), bag('w', 0.5)), { ...heavy, weight: 9 });
  assert.match(putIn(byWeight, first(byWeight, 'h'), first(byWeight, 'w')).error ?? '', /will not fit/);

  const byBoard = addItem(addItem(emptyInventory(), boarded('g', 'x')), shaped('big', 'xx/xx'));
  assert.match(putIn(byBoard, first(byBoard, 'big'), first(byBoard, 'g')).error ?? '', /no room the shape of/);

  // Neither set is a bag that swallows anything, and that is legal.
  const anything = addItem(addItem(emptyInventory(), { ...bag('n', 0), capacity: undefined, grid: undefined, id: 'n' }), heavy);
  assert.equal(isContainer(findHolding(anything, 'n')!.item), false, 'though it is then not a container at all');
});

test('a thing on a board KNOWS WHERE IT SITS', () => {
  const inv = addItem(addItem(emptyInventory(), boarded('g', 'xxx/xxx')), shaped('t', 'xx'));
  const stowed = putIn(inv, first(inv, 't'), first(inv, 'g')).inventory;

  const inside = findHolding(stowed, 't');
  assert.ok(inside?.at, 'it has a square');
  assert.deepEqual(inside!.at, { x: 0, y: 0 }, 'the first one that fits, scanning top-left');
});

test('two things do not sit on the same squares', () => {
  let inv = addItem(addItem(addItem(emptyInventory(), boarded('g', 'xxxx/xxxx')), shaped('a', 'xx')), shaped('b', 'xx'));
  const g = first(inv, 'g');
  inv = putIn(inv, first(inv, 'a'), g).inventory;
  inv = putIn(inv, first(inv, 'b'), g).inventory;

  const held = findHolding(inv, g)!.contents!.held;
  assert.equal(held.length, 2);
  assert.notDeepEqual(held[0].at, held[1].at);
});

test('a board fills up, and then refuses — however light the thing is', () => {
  // The whole difference between a grid and a weight limit: a full bag is full
  // even when what you are holding weighs nothing at all.
  let inv = addItem(addItem(addItem(emptyInventory(), boarded('g', 'xx')), shaped('a', 'xx')), { ...shaped('b', 'x'), weight: 0 });
  const g = first(inv, 'g');
  inv = putIn(inv, first(inv, 'a'), g).inventory;

  assert.match(putIn(inv, first(inv, 'b'), g).error ?? '', /no room the shape of/);
});

test('AN IRREGULAR CONTAINER IS SEARCHED WHERE IT ACTUALLY HAS ROOM', () => {
  // A board is not a rectangle. A frame with a notch out of it takes a small
  // thing and refuses a wide one, and neither answer needs a special case.
  const notched = addItem(emptyInventory(), boarded('g', 'xxx/x..'));
  let inv = addItem(notched, shaped('wide', 'xxx'));
  assert.equal(putIn(inv, first(inv, 'wide'), first(inv, 'g')).error, null);

  const square = addItem(notched, shaped('sq', 'xx/xx'));
  assert.match(putIn(square, first(square, 'sq'), first(square, 'g')).error ?? '', /no room/);
});

test('taking a thing back out gives up its square', () => {
  const inv = addItem(addItem(emptyInventory(), boarded('g', 'xxx/xxx')), shaped('t', 'xx'));
  // Held before stowing, because once it is in the bag it is no longer one of
  // the things in your hands — which is the point.
  const thing = first(inv, 't');
  const stowed = putIn(inv, thing, first(inv, 'g')).inventory;
  assert.ok(findHolding(stowed, thing)?.at, 'it has a square while it is in there');

  const out = takeOut(stowed, thing).inventory;
  assert.equal(findHolding(out, thing)?.at, undefined, 'and none once it is in your hands');
});

test('A GENERATED PACK HAS A BOARD, so the shape module is reached from play', () => {
  // `shape.ts` was green, tested and reachable from nothing since it was
  // written. A real pack, generated from the catalogue, is what reaches it.
  const found = pack(mulberry32(4), 14);
  assert.ok(found.grid, 'a pack has a board');
  assert.ok(boardOf(found)!.cells.length > 0);
});
