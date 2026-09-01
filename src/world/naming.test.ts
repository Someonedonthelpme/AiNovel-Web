import test from 'node:test';
import assert from 'node:assert/strict';
import { displayNames, humanise, humanisePlaces } from './naming.ts';
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
