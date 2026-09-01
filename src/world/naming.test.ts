import test from 'node:test';
import assert from 'node:assert/strict';
import { danglingTokens, displayNames, humanise, humanisePlaces, pruneDangling, tidyAffordances } from './naming.ts';
import { person, place } from './fixtures.ts';
import type { Person } from './types.ts';

const people = (): Record<string, Person> => ({
  elda_shopkeep: person('elda_shopkeep', { name: 'Elda' }),
  rhys: person('rhys', { name: 'Rhys' }),
});

const places = () => [
  place('warehouse_south', { name: 'South Warehouse', description: 'salvaged metal fills warehouse_south', affordances: ['search warehouse_south'] }),
  place('stair_tower', { name: 'Tower Stair', affordances: ['climb stair_tower'] }),
  place("elda's_shop", { name: 'Elda’s Shop' }),
  place('town', { name: 'Ashfall' }),
];

test('an id a player was never meant to read is replaced by the name', () => {
  const names = displayNames(places(), people());
  assert.equal(humanise('climb stair_tower', names), 'climb Tower Stair');
  assert.equal(humanise("the door of elda's_shop", names), 'the door of Elda’s Shop');
});

test('a generated person id never survives into prose', () => {
  // Observed: suggestions read "talk to guardcaptain" and "buy fish from
  // fisherman1". Person ids name one individual, so they are always rewritten
  // — unlike place ids, which collide with ordinary English.
  const cast = { guardcaptain: person('guardcaptain', { name: 'Captain Elara Vane' }), fisherman1: person('fisherman1', { name: 'Finnian Grey' }) };
  const names = displayNames([], cast);
  assert.equal(humanise('talk to guardcaptain', names), 'talk to Captain Elara Vane');
  assert.equal(humanise('buy fish from fisherman1', names), 'buy fish from Finnian Grey');
});

test('a plain word that happens to be an id is left alone', () => {
  // Substituting these would turn "walk into the town" into "walk into the
  // Ashfall" — a worse sentence than the one being fixed.
  const names = displayNames(places(), people());
  assert.equal(humanise('walk into the town', names), 'walk into the town');
  assert.equal(names.has('town'), false);
  assert.equal(names.has('rhys'), true, 'but a person id is always rewritten');
});

test('people ids are rewritten too', () => {
  const names = displayNames(places(), people());
  assert.equal(humanise('ask elda_shopkeep about rope', names), 'ask Elda about rope');
});

test('capitalisation does not let an id through', () => {
  const names = displayNames(places(), people());
  assert.equal(humanise('Warehouse_South is empty', names), 'South Warehouse is empty');
});

test('every player-facing string on a place is cleaned', () => {
  const cleaned = humanisePlaces(places(), people());
  const warehouse = cleaned.find((p) => p.id === 'warehouse_south');
  assert.equal(warehouse?.description, 'salvaged metal fills South Warehouse');
  assert.deepEqual(warehouse?.affordances, ['search South Warehouse']);
  assert.equal(warehouse?.id, 'warehouse_south', 'the id itself is untouched — it is a key');
});

test('nothing is invented when there is nothing to replace', () => {
  const clean = [place('a_b', { name: 'A Place', description: 'a quiet room', affordances: ['wait'] })];
  const out = humanisePlaces(clean, {});
  assert.equal(out[0].description, 'a quiet room');
  assert.deepEqual(out[0].affordances, ['wait']);
});

test('a longer id containing a shorter one is not half-rewritten', () => {
  const ps = [
    place('south_gate', { name: 'South Gate' }),
    place('south_gate_tower', { name: 'Gate Tower', affordances: ['climb south_gate_tower'] }),
  ];
  const names = displayNames(ps, {});
  assert.equal(humanise('climb south_gate_tower', names), 'climb Gate Tower');
});

/* -------------------------------------------------------------------------- */
/* References to people who were never created                                 */
/* -------------------------------------------------------------------------- */

test('an action naming somebody who does not exist is dropped', () => {
  // Observed: a suggestion chip reading "listen to storyteller1" for a person
  // the model referenced but never defined. Substitution cannot repair it —
  // there is no name — and the player will try the action.
  const places = [
    place('square', {
      name: 'The Square',
      affordances: ['listen to storyteller1', 'watch the crowd', 'buy fish from fisherman1'],
    }),
  ];
  const cast = { fisherman1: person('fisherman1', { name: 'Finnian Grey' }) };

  const pruned = pruneDangling(places, cast);
  assert.deepEqual(pruned.places[0].affordances, ['watch the crowd', 'buy fish from fisherman1']);
  assert.equal(pruned.dropped.length, 1);
  assert.match(pruned.dropped[0], /storyteller1/);
});

test('ordinary prose is never mistaken for a dangling reference', () => {
  const places = [place('dock', { affordances: ['mend the nets', 'watch the tide', 'talk to the harbour guard'] })];
  const pruned = pruneDangling(places, {});
  assert.equal(pruned.dropped.length, 0, 'plain English has no machine tokens in it');
});

test('only identifier-shaped tokens count as dangling', () => {
  assert.deepEqual(danglingTokens('watch the crowd'), []);
  assert.deepEqual(danglingTokens('listen to storyteller1'), ['storyteller1']);
  assert.deepEqual(danglingTokens('search warehouse_south'), ['warehouse_south']);
});

test('a resolved reference survives the prune', () => {
  // pruneDangling runs after humanisePlaces in the generators, but it must not
  // drop an action whose id it can still account for.
  const places = [place('shop', { affordances: ['ask elda_shopkeep about rope'] })];
  const cast = { elda_shopkeep: person('elda_shopkeep', { name: 'Elda' }) };
  assert.deepEqual(pruneDangling(places, cast).dropped, []);
});

test('two actions crammed into one string become two actions', () => {
  // Observed as a single chip: `Observe Corvus repairing a boat", "Check
  // Beryl's herb garden`. The model emitted two array elements as one, leaving
  // the JSON quoting it meant to produce inside the text.
  const crammed = ['Observe Corvus repairing a boat”, “Check Beryl’s herb garden', 'watch the tide'];
  assert.deepEqual(tidyAffordances(crammed), [
    'Observe Corvus repairing a boat',
    'Check Beryl’s herb garden',
    'watch the tide',
  ]);
});

test('a well-formed action list is left exactly as it is', () => {
  const clean = ['mend the nets', 'watch the tide'];
  assert.deepEqual(tidyAffordances(clean), clean);
});

test('stray quotes are trimmed and duplicates collapse', () => {
  assert.deepEqual(tidyAffordances(['"search the hold"', 'search the hold', '   ']), ['search the hold']);
});

test('a place with nothing to substitute still gets tidied', () => {
  // humanisePlaces used to return early when there were no ids to replace,
  // which skipped the repair entirely for worlds with plain place names.
  const places = [place('hold', { affordances: ['open the crate”, “count the sacks'] })];
  assert.deepEqual(humanisePlaces(places, {})[0].affordances, ['open the crate', 'count the sacks']);
});
