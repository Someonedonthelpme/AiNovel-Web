import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuilding, buildingAt, CAPS, freePlotsOf, rulerOf, SETTLEMENT_TIERS, soulsOf, tierOf, townPlan } from './settlement.ts';
import { bestPath, drawMap, fieldId, hubId, portalsOf } from './map.ts';
import { linkMinutes } from './travel.ts';
import { groundFloor, place, world } from './fixtures.ts';
import { populationAt, sizeIn } from '../character/population.ts';
import { speciesFor } from '../character/species.ts';
import { PLAYER } from '../social/edge.ts';
import type { Place, Region, World } from './types.ts';

/*
 * The town skeleton (DESIGN 6c §3c-ii): a settlement's TIER comes first, and its
 * caps, its ruler, the size of its ground, its streets and its plots follow.
 */

/** A world whose town stands at `tier`, with a crowd to fill it. */
function townOfTier(tier: (typeof SETTLEMENT_TIERS)[number], over: Partial<Place> = {}): World {
  const base = world({ seed: 11 });
  const ground = base.regions['floor-0'] as Region;
  const places = ground.places.map((p) => (p.id === 'town' ? { ...p, tier, ...over } : p));
  return { ...base, species: speciesFor(11), regions: { 'floor-0': { ...ground, places } } };
}
const held = (w: World): World => {
  const ground = w.regions['floor-0'] as Region;
  return { ...w, regions: { 'floor-0': { ...ground, places: ground.places.map((p) => (p.id === 'town' ? { ...p, holder: PLAYER } : p)) } } };
};

test('the tier ladder is closed, and each rung allows more than the one below', () => {
  assert.deepEqual([...SETTLEMENT_TIERS], ['hamlet', 'village', 'town', 'city', 'metropolis', 'megacity']);
  const caps = SETTLEMENT_TIERS.map((t) => CAPS[t]);
  assert.ok(caps.every((c, i) => i === 0 || (c.crowd > caps[i - 1].crowd && c.plots > caps[i - 1].plots && c.radius > caps[i - 1].radius)));
  assert.ok(caps.every((c, i) => i === 0 || c.souls[0] >= caps[i - 1].souls[1]), 'souls climb by rungs, not overlaps');
  assert.deepEqual(SETTLEMENT_TIERS.map((t) => CAPS[t].ruler), ['elder', 'headman', 'mayor', 'lord', 'governor', 'overlord']);
});

test('every settlement is dealt a tier from the seed; nothing else has one', () => {
  const w = world({ seed: 5 });
  assert.ok(SETTLEMENT_TIERS.includes(tierOf(w, 'floor-0', 'town')!));
  assert.equal(tierOf(w, 'floor-0', 'town'), tierOf(world({ seed: 5 }), 'floor-0', 'town'), 'dealt, not drifting');
  assert.equal(tierOf(w, 'floor-0', 'well'), null, 'a dry well is not a settlement');
  const dealt = new Set([...Array(60).keys()].map((n) => tierOf(world({ seed: n + 1 }), 'floor-0', 'town')));
  assert.ok(dealt.size > 1, 'the ladder is actually used');
  // A tower floor never deals the top two: a metropolis wants districts (DESIGN 3c-ii).
  assert.ok(![...dealt].some((t) => t === 'metropolis' || t === 'megacity'));
});

test('souls follow the real curve, inside the rung the tier names', () => {
  for (const tier of SETTLEMENT_TIERS) {
    const souls = soulsOf(townOfTier(tier), 'floor-0', 'town')!;
    const [low, high] = CAPS[tier].souls;
    assert.ok(souls >= low && souls <= high, `${tier}: ${souls} outside ${low}..${high}`);
  }
  assert.ok(soulsOf(townOfTier('megacity'), 'floor-0', 'town')! > 1_000_000);
  assert.equal(soulsOf(world(), 'floor-0', 'well'), null);
});

test('a town is as big as its tier; a place with no tier keeps the old shape', () => {
  const small = drawMap(townOfTier('hamlet'), hubId('floor-0', 'town'));
  const big = drawMap(townOfTier('city'), hubId('floor-0', 'town'));
  assert.equal(small.rows.length, 2 * CAPS.hamlet.radius + 3);
  assert.equal(big.rows.length, 2 * CAPS.city.radius + 3);
  assert.equal(drawMap(townOfTier('hamlet'), hubId('floor-0', 'well')).rows.length, 2 * 14 + 3, 'a landmark is as it was');
});

test('a street runs from every way in to the square, and every plot opens onto one', () => {
  const w = townOfTier('town');
  const m = drawMap(w, hubId('floor-0', 'town'));
  const plan = townPlan(w, 'floor-0', 'town')!;
  for (const d of portalsOf(w, m)) assert.ok(bestPath(m, d, plan.square) < Infinity, 'the square is reachable from every way in');
  const street = new Set(plan.streets.map((c) => `${c.x},${c.y}`));
  for (const p of plan.plots) {
    assert.ok(bestPath(m, p.door, plan.square) < Infinity, 'and so is every plot');
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => street.has(`${p.door.x + dx},${p.door.y + dy}`));
    assert.ok(touches || street.has(`${p.door.x},${p.door.y}`), 'a plot door stands on its street');
  }
});

test('a town never draws more plots than its tier allows, and always has room for something', () => {
  for (const tier of SETTLEMENT_TIERS) {
    const plots = townPlan(townOfTier(tier), 'floor-0', 'town')!.plots;
    assert.ok(plots.length > 0 && plots.length <= CAPS[tier].plots, `${tier}: ${plots.length} of ${CAPS[tier].plots}`);
  }
});

test('the crowd a settlement fields is capped by its tier', () => {
  const hamlet = sizeIn(populationAt(townOfTier('hamlet'), 'floor-0', 'town', 0) ?? []);
  const city = sizeIn(populationAt(townOfTier('city'), 'floor-0', 'town', 0) ?? []);
  assert.ok(hamlet > 0 && hamlet <= CAPS.hamlet.crowd, `hamlet crowd ${hamlet}`);
  assert.ok(city <= CAPS.city.crowd);
  assert.ok(city > hamlet, 'a city holds more people than a hamlet');
});

test('the ruler is ranked by the tier, and a place nobody holds has none', () => {
  assert.equal(rulerOf(held(townOfTier('city')), 'floor-0', 'town')?.rank, 'lord');
  assert.equal(rulerOf(held(townOfTier('hamlet')), 'floor-0', 'town')?.rank, 'elder');
  const empty = townOfTier('city', { people: [] });
  assert.equal(rulerOf(empty, 'floor-0', 'town'), null, 'nobody there to hold it');
});

test('the same values draw the same town, and a bigger tier draws a different one', () => {
  const w = townOfTier('village');
  assert.deepEqual(drawMap(w, hubId('floor-0', 'town')), drawMap(w, hubId('floor-0', 'town')));
  assert.notDeepEqual(drawMap(townOfTier('city'), hubId('floor-0', 'town')).rows, drawMap(w, hubId('floor-0', 'town')).rows);
});

test('fields and their link times are untouched by what a town grew into', () => {
  assert.equal(linkMinutes(townOfTier('city'), 'town', 'market'), linkMinutes(townOfTier('hamlet'), 'town', 'market'));
  assert.deepEqual(drawMap(townOfTier('city'), fieldId('floor-0', 'town', 'market')).rows,
    drawMap(townOfTier('hamlet'), fieldId('floor-0', 'town', 'market')).rows);
});

/*
 * A building's footprint eats the settlement's plot budget (DESIGN 6c §3f).
 * No `Building` schema yet — just accounting against a real town's plots.
 */

test('a settlement with nothing built yet has all its plots free', () => {
  const w = world({ seed: 5 });
  const plan = townPlan(w, 'floor-0', 'town')!;
  assert.equal(freePlotsOf(w, 'floor-0', 'town', 0), plan.plots.length);
});

test('occupied modules are subtracted from the real plot count', () => {
  const w = world({ seed: 5 });
  const plan = townPlan(w, 'floor-0', 'town')!;
  assert.equal(freePlotsOf(w, 'floor-0', 'town', 2), plan.plots.length - 2);
});

test('a non-settlement place has no free plots to speak of', () => {
  assert.equal(freePlotsOf(world({ seed: 5 }), 'floor-0', 'gate', 0), null);
});

/*
 * A place can hold buildings, each addressable by a stable id (DESIGN 6c
 * §2a). Module/plot occupancy isn't wired in yet - that waits on real
 * per-building workstation counts, which don't exist as stored data yet.
 */

test('a place with nothing built has no buildings', () => {
  assert.deepEqual(place('p1').buildings ?? [], []);
});

test('a building can be found on a place by id', () => {
  const p = addBuilding(place('p1'), { id: 'smithy-1', tier: 1, container: {} });
  assert.deepEqual(buildingAt(p, 'smithy-1'), { id: 'smithy-1', tier: 1, container: {} });
});

test('a building not on the place is not found', () => {
  assert.equal(buildingAt(place('p1'), 'nope'), null);
});

test('adding a building with a taken id is a no-op', () => {
  const p1 = addBuilding(place('p1'), { id: 'x', tier: 1, container: {} });
  const p2 = addBuilding(p1, { id: 'x', tier: 2, container: {} });
  assert.equal(buildingAt(p2, 'x')!.tier, 1);
});
