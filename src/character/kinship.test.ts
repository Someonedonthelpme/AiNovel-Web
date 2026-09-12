import test from 'node:test';
import assert from 'node:assert/strict';
import { kinshipOf, withKin } from './kinship.ts';
import { groupOf, leavesOf, speciesFor } from './species.ts';
import { axisOf } from '../social/edge.ts';

const kinds = speciesFor(11);
const leaves = leavesOf(kinds);
const mine = leaves[0];
// A different GROUP of the same type — two species of one group are kin, since a
// group is the unit kinship runs on.
const cousin = leaves.find((k) => k.type === mine.type && groupOf(kinds, k.id) !== groupOf(kinds, mine.id))!;
const stranger = leaves.find((k) => k.type !== mine.type)!;

test('your own kind starts warmer than a stranger, and a stranger starts cooler', () => {
  const own = kinshipOf(kinds, mine.id, mine.id);
  const far = kinshipOf(kinds, mine.id, stranger.id);

  assert.ok((own.familiarity ?? 0) > 0, 'kin already know of each other');
  assert.ok((own.trust ?? 0) > 0, 'and start further along than nobody');
  assert.ok((far.trust ?? 0) < 0, 'another kind of thing starts cooler than nobody');
  assert.ok((own.trust ?? 0) > (far.trust ?? 0));
});

test('a cousin group of your own type is neither kin nor stranger', () => {
  const near = kinshipOf(kinds, mine.id, cousin.id);
  assert.equal(near.trust ?? 0, 0, `${mine.id} vs ${cousin.id} should be neutral`);
});

test('kinship is the same either way round, and the same every time', () => {
  assert.deepEqual(kinshipOf(kinds, mine.id, stranger.id), kinshipOf(kinds, stranger.id, mine.id));
  assert.deepEqual(kinshipOf(kinds, mine.id, mine.id), kinshipOf(kinds, mine.id, mine.id));
});

test('a town of your own kind meets you warmer than a town of something else', () => {
  const cast = [{ id: 'a', species: mine.id }, { id: 'b', species: stranger.id }];
  const edges = withKin({}, kinds, mine.id, cast);

  const kinTrust = axisOf(edges, 'a', 'pc', 'trust');
  const otherTrust = axisOf(edges, 'b', 'pc', 'trust');
  assert.ok(kinTrust > otherTrust, `kin ${kinTrust} vs stranger ${otherTrust}`);
  assert.ok(axisOf(edges, 'a', 'pc', 'familiarity') > axisOf(edges, 'b', 'pc', 'familiarity'), 'they have heard of your sort');
});

test('people of one kind know each other, so news travels among them', () => {
  const cast = [{ id: 'a', species: mine.id }, { id: 'b', species: mine.id }, { id: 'c', species: stranger.id }];
  const edges = withKin({}, kinds, stranger.id, cast);

  assert.ok(axisOf(edges, 'a', 'b', 'familiarity') > 0, 'two of a kind have heard of each other');
  assert.equal(axisOf(edges, 'a', 'c', 'familiarity'), 0, 'and no more of a stranger than anyone else');
});
