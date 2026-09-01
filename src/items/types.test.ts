import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, countOf, emptyInventory, equip, equippedArmour, equippedAttack,
  equippedGrants, isEquipped, removeItem, unequip,
} from './types.ts';
import type { Item } from './types.ts';
import { rations, weapon, armour, namesTheSameThing, stripMechanics, weaponFromAttack } from './catalogue.ts';
import { sword } from '../combat/fixtures.ts';
import { startingInventory } from '../play/state.ts';
import { sheet } from '../session/fixtures.ts';
import { mulberry32 } from '../engine/roll.ts';

const ring: Item = {
  id: 'ring_of_note', name: 'a plain ring', description: '',
  kind: 'equipment', slot: 'trinket', grants: { int: 2 }, stackable: false, value: 10,
};

test('stackable things collapse into one line', () => {
  const food = rations(2);
  let inv = addItem(emptyInventory(), food.item, food.count);
  inv = addItem(inv, food.item, 3);
  assert.equal(inv.stacks.length, 1);
  assert.equal(countOf(inv, food.item.id), 5);
});

test('unstackable things take a line each, so provenance survives', () => {
  const rng = mulberry32(1);
  let inv = addItem(emptyInventory(), weapon(rng, 3));
  inv = addItem(inv, weapon(mulberry32(99), 12));
  assert.equal(inv.stacks.length, 2, 'two swords from different floors are two swords');
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
  inv = unequip(inv, 'trinket');
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
  assert.equal(made.slot, 'weapon');
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
  assert.equal(inv.stacks.filter((s) => s.item.slot === 'weapon').length, 1, 'and only one of it');
});
