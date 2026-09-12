import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_PLANS, planFor, slotsFor } from './bodyplan.ts';
import { leavesOf, speciesFor } from './species.ts';
import { STANDARD } from '../rules/ruleset.ts';
import { addItem, emptyInventory, equip } from '../items/types.ts';
import type { Item } from '../items/types.ts';
import { pack, weapon } from '../items/catalogue.ts';
import { mulberry32 } from '../engine/roll.ts';

const nodes = (seed = 11) => speciesFor(seed);

/** Try to wear something with this body. */
function wear(item: Item, slots: typeof STANDARD.gear.slots) {
  const bag = addItem(emptyInventory(), item);
  const rules = { ...STANDARD, gear: { ...STANDARD.gear, slots } };
  return equip(bag, bag.held[0].instance.id, rules);
}

test('every group has a body, and it suits what kind of thing it is', () => {
  for (let seed = 0; seed < 20; seed++) {
    const tree = nodes(seed);
    for (const group of tree.filter((n) => n.level === 'group')) {
      const plan = planFor(seed, tree, group.id);
      assert.ok(BODY_PLANS[plan], `${group.id} has no body plan`);
      if (group.type === 'humanoid') assert.notEqual(plan, 'beastly', 'people have hands');
      if (group.type === 'beast') assert.notEqual(plan, 'upright', 'a wolf does not stand and wield');
      assert.equal(plan, planFor(seed, tree, group.id), 'the same world, the same body');
    }
  }
});

test('a body with no hands cannot wield, and one with hands can', () => {
  const axe = weapon(mulberry32(3), 1);
  assert.equal(wear(axe, slotsFor(STANDARD, 'upright')).error, null, 'hands are for holding things');

  const beastly = wear(axe, slotsFor(STANDARD, 'beastly'));
  assert.match(beastly.error ?? '', /nowhere on you/, 'a paw is not a hand');
});

test('wings take the back, so a winged thing carries no pack', () => {
  const satchel = pack(mulberry32(1), 1);
  assert.equal(wear(satchel, slotsFor(STANDARD, 'upright')).error, null);
  assert.match(wear(satchel, slotsFor(STANDARD, 'winged')).error ?? '', /nowhere on you/, 'the back is full of wing');
});

test('a climber wears what their GROUP is shaped like, not what their lineage is', () => {
  const tree = nodes(11);
  const lineage = leavesOf(tree)[0];
  const species = tree.find((n) => n.id === lineage.parent)!;
  const group = tree.find((n) => n.id === species.parent)!;

  assert.equal(planFor(11, tree, lineage.id), planFor(11, tree, group.id), 'a body plan is the group\'s');
});

test('a world stored before bodies keeps the body the world had', () => {
  assert.deepEqual(slotsFor(STANDARD, planFor(11, [], 'nothing-here')), STANDARD.gear.slots);
});
