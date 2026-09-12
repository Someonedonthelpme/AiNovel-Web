import test from 'node:test';
import assert from 'node:assert/strict';
import { huntedBy, preyOf } from './prey.ts';
import { speciesFor } from './species.ts';

const nodes = (seed = 11) => speciesFor(seed);

test('a group hunts one other kind, never its own, and always the same one', () => {
  let hunters = 0;
  for (let seed = 0; seed < 20; seed++) {
    const tree = nodes(seed);
    for (const group of tree.filter((n) => n.level === 'group')) {
      const prey = preyOf(seed, tree, group.id);
      assert.deepEqual(prey, preyOf(seed, tree, group.id), 'the same world, the same quarry');
      if (!prey) continue;

      hunters++;
      assert.notEqual(prey, group.id, `${group.id} hunts itself`);
      const quarry = tree.find((n) => n.id === prey)!;
      assert.equal(quarry.level, 'group', 'prey is a group, like everything a group deals with');
      assert.notEqual(quarry.type, group.type, `${group.id} hunts its own sort of thing`);
    }
  }
  assert.ok(hunters > 0, 'nothing in twenty worlds hunts anything — the mechanic does nothing');
});

test('being hunted is the other side of hunting, and reads both ways', () => {
  const tree = nodes(11);
  const hunter = tree.filter((n) => n.level === 'group').find((g) => preyOf(11, tree, g.id))!;
  const quarry = preyOf(11, tree, hunter.id)!;

  assert.ok(huntedBy(11, tree, quarry).includes(hunter.id), 'the quarry knows what is after it');
  assert.equal(huntedBy(11, tree, hunter.id).includes(hunter.id), false);
});
