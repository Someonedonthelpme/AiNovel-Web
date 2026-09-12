import test from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, groupsAt, livesAt } from './habitat.ts';
import { speciesFor } from './species.ts';
import { TOWER_DEPTH } from '../items/catalogue.ts';

const nodes = (seed = 11) => speciesFor(seed);

test('every group lives somewhere inside the tower', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (const group of nodes(seed).filter((n) => n.level === 'group')) {
      const band = bandOf(seed, nodes(seed), group.id);
      assert.ok(band.from >= 0 && band.to <= TOWER_DEPTH, `${group.id} lives at ${band.from}..${band.to}`);
      assert.ok(band.to >= band.from, `${group.id} has no depth at all`);
      assert.deepEqual(band, bandOf(seed, nodes(seed), group.id), 'the same world, the same range');
    }
  }
});

test('every floor of the tower has something that really lives there', () => {
  // Not merely something `groupsAt` will hand back: its nearest-group fallback
  // made this pass while floors 1 and 25-30 of world 11 had no group whose band
  // covered them at all. Bands are spread across the tower for this reason.
  for (let seed = 0; seed < 20; seed++) {
    const tree = nodes(seed);
    const groups = tree.filter((n) => n.level === 'group');
    for (let floor = 1; floor <= TOWER_DEPTH; floor++) {
      assert.ok(
        groups.some((g) => livesAt(seed, tree, g.id, floor)),
        `seed ${seed}: nothing lives on floor ${floor}`,
      );
    }
  }
});

test('nothing lives everywhere, so a deep floor is not the shallow one again', () => {
  const tree = nodes(11);
  const shallow = groupsAt(11, tree, 1).map((g) => g.id);
  const deep = groupsAt(11, tree, TOWER_DEPTH).map((g) => g.id);
  assert.notDeepEqual(shallow, deep, 'the top of the tower holds what the bottom does');
  assert.ok(shallow.some((id) => !deep.includes(id)), 'something is left behind on the way up');
});

test('whether a group lives on a floor is what the band says', () => {
  const tree = nodes(11);
  const group = tree.find((n) => n.level === 'group')!;
  const band = bandOf(11, tree, group.id);
  assert.equal(livesAt(11, tree, group.id, band.from), true);
  assert.equal(livesAt(11, tree, group.id, band.to), true);
  assert.equal(livesAt(11, tree, group.id, band.from - 1), false, 'not below where it lives');
  assert.equal(livesAt(11, tree, group.id, band.to + 1), false, 'and not above');
});
