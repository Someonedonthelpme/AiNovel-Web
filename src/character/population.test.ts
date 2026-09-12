import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, aggregateKey, derivePopulation, populationAt, sizeIn, thinPopulation } from './population.ts';
import { packAt } from './habitat.ts';
import { leavesUnder, speciesFor } from './species.ts';

const kinds = speciesFor(11);
const floor = 4;
const world = { seed: 11, species: kinds };

test('a place holds a population: lineages of the pack, at trades, in numbers', () => {
  const cohorts = populationAt(world, 'floor-4', 'gate', floor)!;
  const leaves = leavesUnder(kinds, packAt(11, kinds, floor)!).map((k) => k.id);

  assert.ok(cohorts.length > 0, 'somebody lives at the gate');
  for (const c of cohorts) {
    assert.ok(leaves.includes(c.subspecies), `${c.subspecies} is not of this floor's pack`);
    assert.ok(c.size > 0, 'a cohort of nobody is not a cohort');
  }
  assert.deepEqual(cohorts, populationAt(world, 'floor-4', 'gate', floor), 'the same place, the same crowd');
});

test('the gate is not the square: a population is per PLACE', () => {
  const gate = populationAt(world, 'floor-4', 'gate', floor)!;
  const square = populationAt(world, 'floor-4', 'square', floor)!;
  assert.notDeepEqual(gate, square, 'two places of one floor hold the same crowd');
});

test('KILLING THINS IT, and the dead do not come back', () => {
  const before = populationAt(world, 'floor-4', 'gate', floor)!;
  const one = { subspecies: before[0].subspecies, profession: before[0].profession };
  const thinned = { ...world, populations: thinPopulation(world, 'floor-4', 'gate', floor, [one, one]) };
  const after = populationAt(thinned, 'floor-4', 'gate', floor)!;

  assert.equal(after[0].size, before[0].size - 2, 'two of that sort are gone from the gate');
  assert.equal(sizeIn(after), sizeIn(before) - 2, 'and gone from the place, not moved within it');
});

test('killing one cohort leaves its neighbours alone', () => {
  const before = populationAt(world, 'floor-4', 'gate', floor)!;
  const other = before.find((c) => c.subspecies !== before[0].subspecies || c.profession !== before[0].profession)!;
  const dead = Array.from({ length: before[0].size }, () => before[0]);
  const thinned = { ...world, populations: thinPopulation(world, 'floor-4', 'gate', floor, dead) };
  const after = populationAt(thinned, 'floor-4', 'gate', floor)!;

  assert.ok(!after.some((c) => c.subspecies === before[0].subspecies && c.profession === before[0].profession),
    'that lineage at that trade is cleared out');
  assert.ok(after.some((c) => c.subspecies === other.subspecies && c.profession === other.profession && c.size === other.size),
    'and the others are untouched');
});

test('a world with no kinds has no population at all — which is not an empty one', () => {
  assert.equal(populationAt({ seed: 11 }, 'floor-4', 'gate', floor), null, 'an old world answers nothing, not nobody');
});

test('a compressed floor keeps one aggregate, and its places read it', () => {
  const populations = {
    gate: derivePopulation(11, kinds, packAt(11, kinds, floor)!, 'gate', floor),
    square: derivePopulation(11, kinds, packAt(11, kinds, floor)!, 'square', floor),
  };
  const total = sizeIn(populations.gate) + sizeIn(populations.square);
  const folded = aggregate(populations, 'floor-4', ['gate', 'square']);

  assert.deepEqual(Object.keys(folded), [aggregateKey('floor-4')], 'the places are gone with the geometry');
  assert.equal(sizeIn(folded[aggregateKey('floor-4')]), total, 'and nobody was lost folding them');
  assert.equal(
    sizeIn(populationAt({ ...world, populations: folded }, 'floor-4', 'a-new-name', floor)!),
    total,
    'a place the model names afresh inherits the thinned floor',
  );
});
