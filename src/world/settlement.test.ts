import test from 'node:test';
import assert from 'node:assert/strict';
import { addBuilding, buildingAt, CAPS, CROWD_BANDS, crowdBand, freePlotsOf, occupiedModulesOf, SETTLEMENT_TIERS, soulsOf, tierOf, townPlan, withBuilding } from './settlement.ts';
import { modulesNeeded } from './building.ts';
import { WORKSTATION_SUBKINDS } from './workstation.ts';
import { bestPath, drawMap, fieldId, hubId, portalsOf } from './map.ts';
import { linkMinutes } from './travel.ts';
import { groundFloor, place, world } from './fixtures.ts';
import { populationAt, sizeIn } from '../character/population.ts';
import { speciesFor } from '../character/species.ts';
import type { Place, Region, World } from './types.ts';
import type { Building, BuildingCategory, Shift } from './workstation.ts';

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

/*
 * A building's workstation count is what modules/plots it actually occupies
 * (DESIGN 6c §3f/§3h) - a real derivation now, not a hand-fed number.
 */

test('workstation subkinds are closed to three', () => {
  assert.deepEqual([...WORKSTATION_SUBKINDS], ['economic', 'service', 'administrative']);
});

test('a building with no workstations occupies no modules', () => {
  const b: Building = { tier: 1, container: {} };
  assert.equal(modulesNeeded(b.workstations?.length ?? 0), 0);
});

test('occupiedModulesOf sums modules across every building on a place', () => {
  const p1 = addBuilding(place('p1'), { id: 'a', tier: 1, container: {}, workstations: [{ subkind: 'economic' }, { subkind: 'economic' }] });
  const p2 = addBuilding(p1, { id: 'b', tier: 1, container: {}, workstations: [{ subkind: 'service' }] });
  assert.equal(occupiedModulesOf(p2), modulesNeeded(2) + modulesNeeded(1));
});

test("a settlement's free plots follow real building occupancy", () => {
  const w = world({ seed: 5 });
  const ground = w.regions['floor-0'] as Region;
  const town = ground.places.find((p) => p.id === 'town')!;
  const built = addBuilding(town, {
    id: 'a',
    tier: 1,
    container: {},
    workstations: [{ subkind: 'economic' }, { subkind: 'economic' }, { subkind: 'economic' }, { subkind: 'economic' }],
  });
  const plan = townPlan(w, 'floor-0', 'town')!;
  assert.equal(freePlotsOf(w, 'floor-0', 'town', occupiedModulesOf(built)), plan.plots.length - modulesNeeded(4));
});

test('a building can be replaced on a place, leaving the others untouched', () => {
  const p1 = addBuilding(addBuilding(place('p1'), { id: 'a', tier: 1, container: {} }), { id: 'b', tier: 1, container: {} });
  const p2 = withBuilding(p1, { id: 'a', tier: 2, container: { material: 5 } });
  assert.equal(buildingAt(p2, 'a')?.tier, 2);
  assert.equal(buildingAt(p2, 'b')?.tier, 1);
});

/*
 * How crowded a settlement feels, as a WORD (DESIGN 6c §3i, 2026-10-02): the headcount out is `soulsOf` times a share
 * for the hour plus the pull of the buildings open now, and the band is read off the ABSOLUTE count — a megacity at
 * 01:00 is not deserted and a hamlet at noon is not crowded. The numbers are placeholders; these cases are the shape.
 */

/** An open building of this kind and shift; its one station serves the `company` need. */
const opening = (id: string, category: BuildingCategory, shift: Shift): Building => ({
  id, tier: 1, container: {}, category,
  workstations: [{ id: `${id}-ws`, subkind: 'service', serviceMethod: { output: [{ need: 'company', amount: 1 }], time: 1 }, shift }],
});
const bandAt = (tier: (typeof SETTLEMENT_TIERS)[number], buildings: Building[], night: boolean) =>
  crowdBand(townOfTier(tier, { buildings }), 'floor-0', 'town', night);
const rank = (band: ReturnType<typeof crowdBand>) => CROWD_BANDS.indexOf(band!);

test('the bands are four ordered words', () => {
  assert.deepEqual([...CROWD_BANDS], ['deserted', 'quiet', 'busy', 'crowded']);
});

test('a hamlet at night is deserted, with or without an inn', () => {
  assert.equal(bandAt('hamlet', [], true), 'deserted');
  assert.equal(bandAt('hamlet', [opening('inn', 'amenities', 'both')], true), 'deserted');
});

test('a city at noon is crowded', () => {
  assert.equal(bandAt('city', [], false), 'crowded');
});

test('a megacity at night is never deserted (the band reads the absolute count)', () => {
  assert.notEqual(bandAt('megacity', [], true), 'deserted');
});

test('a town at night with a pub, a brothel and an inn is at least one band above the same town with none', () => {
  const venues = [opening('pub', 'amenities', 'night'), opening('brothel', 'amenities', 'night'), opening('inn', 'amenities', 'both')];
  assert.ok(rank(bandAt('town', venues, true)) >= rank(bandAt('town', [], true)) + 1);
});

test('a town with only homes at night is unchanged: residential pulls nobody out', () => {
  const homes = [opening('home-1', 'residential', 'night'), opening('home-2', 'residential', 'night')];
  assert.equal(bandAt('town', homes, true), bandAt('town', [], true));
});

test('a place with no souls has no band', () => {
  assert.equal(crowdBand(townOfTier('town'), 'floor-0', 'well', true), null);
});
