import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptLaw, ancestorsOf, alUnitsFor, CRIMINAL_LAWS, hallScopeOf, isBoundBy, isLocalCrossing, lawsBindingAt, lowestCommonAlUnit, rulerSeatOf, setSuccessionLaw, successionOf } from './al.ts';
import type { AlLawId, SuccessionLawId } from './al.ts';
import { groundFloor, place } from './fixtures.ts';
import type { Place, World } from './types.ts';

const worldWith = (places: Place[]): Pick<World, 'seed' | 'regions'> =>
  ({ seed: 1, regions: { 'floor-0': { ...groundFloor(), places } } });

/*
 * AL (the Administrative Layer, DESIGN 6c §3e/§3e-i) is an unbounded tree, one
 * per Region: planet -> continent -> sub-continent -> state -> province ->
 * district -> subdistrict -> village. An AL unit's ruler is never stored on the
 * unit itself - it is derived from the nearest ancestor (itself included) that
 * has a seat, or null if none does (§3e, settled 2026-09-26).
 */

test('ancestorsOf walks from a unit up to its root, itself first', () => {
  const region = { alUnits: {
    v: { id: 'v', kind: 'village' as const, parent: 'd' },
    d: { id: 'd', kind: 'district' as const, parent: 's' },
    s: { id: 's', kind: 'state' as const },
  } };
  assert.deepEqual(ancestorsOf(region, 'v').map((u) => u.id), ['v', 'd', 's']);
});

test('ancestorsOf on a root unit returns just itself', () => {
  const region = { alUnits: { s: { id: 's', kind: 'state' as const } } };
  assert.deepEqual(ancestorsOf(region, 's').map((u) => u.id), ['s']);
});

test('ancestorsOf on an unknown id returns empty', () => {
  assert.deepEqual(ancestorsOf({ alUnits: {} }, 'nope'), []);
});

test("rulerSeatOf returns the unit's own seat when it has one", () => {
  const region = { alUnits: { v: { id: 'v', kind: 'village' as const, seat: 'town-1' } } };
  assert.equal(rulerSeatOf(region, 'v'), 'town-1');
});

test('rulerSeatOf inherits up to the nearest ancestor that has a seat', () => {
  const region = { alUnits: {
    v: { id: 'v', kind: 'village' as const, parent: 'd' },
    d: { id: 'd', kind: 'district' as const, parent: 's', seat: 'city-1' },
    s: { id: 's', kind: 'state' as const },
  } };
  assert.equal(rulerSeatOf(region, 'v'), 'city-1');
});

test('rulerSeatOf is null when nothing in the chain has a seat', () => {
  const region = { alUnits: { v: { id: 'v', kind: 'village' as const } } };
  assert.equal(rulerSeatOf(region, 'v'), null);
});

/*
 * Crossing an AL unit costs like a stair, not like a step (DESIGN 6c §3e-ii):
 * two places share the ordinary walkable scale only when their lowest common
 * AL ancestor is district or deeper.
 */

const twoTowns = () => ({ alUnits: {
  v1: { id: 'v1', kind: 'village' as const, parent: 'd' },
  v2: { id: 'v2', kind: 'village' as const, parent: 'd' },
  d: { id: 'd', kind: 'district' as const, parent: 'st' },
  st: { id: 'st', kind: 'state' as const, parent: 'co' },
  co: { id: 'co', kind: 'continent' as const },
} });

test('lowestCommonAlUnit finds the nearest shared ancestor', () => {
  assert.equal(lowestCommonAlUnit(twoTowns(), 'v1', 'v2')?.id, 'd');
});

test('lowestCommonAlUnit is null when the units share no ancestor', () => {
  const region = { alUnits: { a: { id: 'a', kind: 'state' as const }, b: { id: 'b', kind: 'state' as const } } };
  assert.equal(lowestCommonAlUnit(region, 'a', 'b'), null);
});

test('isLocalCrossing is true within the same district', () => {
  assert.equal(isLocalCrossing(twoTowns(), 'v1', 'v2'), true);
});

test('isLocalCrossing is false across a state or higher', () => {
  const region = { alUnits: {
    v1: { id: 'v1', kind: 'village' as const, parent: 'd1' },
    d1: { id: 'd1', kind: 'district' as const, parent: 'st' },
    v2: { id: 'v2', kind: 'village' as const, parent: 'd2' },
    d2: { id: 'd2', kind: 'district' as const, parent: 'st' },
    st: { id: 'st', kind: 'state' as const },
  } };
  assert.equal(isLocalCrossing(region, 'v1', 'v2'), false);
});

test('isLocalCrossing is false when the units share no ancestor at all', () => {
  const region = { alUnits: { a: { id: 'a', kind: 'village' as const }, b: { id: 'b', kind: 'village' as const } } };
  assert.equal(isLocalCrossing(region, 'a', 'b'), false);
});

/*
 * alUnitsFor generates the AL tree a floor's own places justify (DESIGN 6c
 * §3e-i/§3e-ii): one seat unit per settlement whose TIER maps to an AL rung
 * (the seat rule), chained biggest to smallest. Hamlet/village-tier
 * settlements and wild places get no unit of their own.
 */

test('a city-tier settlement seats a district, and points at it', () => {
  const places = [place('capital', { kind: 'settlement', tier: 'city' })];
  const { alUnits, places: out } = alUnitsFor(worldWith(places), 'floor-0', places);
  const seated = out.find((p) => p.id === 'capital')!;
  assert.equal(alUnits[seated.alUnit!].kind, 'district');
  assert.equal(alUnits[seated.alUnit!].seat, 'capital');
});

test('a town nests under a city on the same floor', () => {
  const places = [
    place('bigcity', { kind: 'settlement', tier: 'city' }),
    place('smalltown', { kind: 'settlement', tier: 'town' }),
  ];
  const { alUnits, places: out } = alUnitsFor(worldWith(places), 'floor-0', places);
  const city = alUnits[out.find((p) => p.id === 'bigcity')!.alUnit!];
  const town = alUnits[out.find((p) => p.id === 'smalltown')!.alUnit!];
  assert.equal(town.parent, city.id);
});

test('hamlet/village-tier settlements get no seat of their own, only the fallback', () => {
  const places = [place('tiny', { kind: 'settlement', tier: 'hamlet' })];
  const { alUnits, places: out } = alUnitsFor(worldWith(places), 'floor-0', places);
  const unit = alUnits[out.find((p) => p.id === 'tiny')!.alUnit!];
  assert.equal(unit.kind, 'village');
  assert.equal(unit.seat, undefined);
});

test('a wild place scatters inside the most local seat that exists', () => {
  const places = [
    place('capital', { kind: 'settlement', tier: 'city' }),
    place('woods', { kind: 'wild' }),
  ];
  const { alUnits, places: out } = alUnitsFor(worldWith(places), 'floor-0', places);
  const seat = out.find((p) => p.id === 'capital')!.alUnit;
  assert.equal(out.find((p) => p.id === 'woods')!.alUnit, seat);
  assert.equal(alUnits[seat!].kind, 'district');
});

/*
 * A hall's law-editing scope (DESIGN 6c §3f/§3k): only the AL unit's own SEAT
 * settlement has one — every other settlement inside that unit is "bare,
 * local-only." A territorial law is a closed, independently-adoptable set on
 * the `criminal` axis (`civil`/`succession` are named but unseeded, no
 * checker yet); a lower tier automatically inherits its overlord's adopted
 * law, never stored locally.
 */

test("hallScopeOf: a seat settlement's hall resolves to its own unit", () => {
  const region = { alUnits: { d1: { id: 'd1', kind: 'district' as const, seat: 'city-1' } } };
  assert.equal(hallScopeOf(region, place('city-1', { alUnit: 'd1' })), 'd1');
});

test('hallScopeOf: a non-seat settlement is bare, local-only — no scope', () => {
  const region = { alUnits: { d1: { id: 'd1', kind: 'district' as const, seat: 'city-1' } } };
  assert.equal(hallScopeOf(region, place('village-1', { alUnit: 'd1' })), null);
});

test('hallScopeOf: a place with no AL unit at all has no scope', () => {
  assert.equal(hallScopeOf({ alUnits: {} }, place('x')), null);
});

test('adoptLaw adds the law to that unit only, not siblings', () => {
  const units = { a: { id: 'a', kind: 'village' as const }, b: { id: 'b', kind: 'village' as const } };
  assert.deepEqual(adoptLaw(units, 'a', 'theft').b.laws, undefined);
});

test('adoptLaw is idempotent', () => {
  const units = { a: { id: 'a', kind: 'village' as const, laws: ['theft'] as AlLawId[] } };
  assert.equal(adoptLaw(units, 'a', 'theft').a.laws!.length, 1);
});

test("a district automatically inherits its state's adopted law — the overlord rule", () => {
  const region = { alUnits: {
    s: { id: 's', kind: 'state' as const, laws: ['theft'] as AlLawId[] },
    d: { id: 'd', kind: 'district' as const, parent: 's' },
  } };
  assert.deepEqual(lawsBindingAt(region, 'd'), ['theft']);
});

test('a unit with no adopted law anywhere in its chain binds nothing', () => {
  const region = { alUnits: { v: { id: 'v', kind: 'village' as const } } };
  assert.deepEqual(lawsBindingAt(region, 'v'), []);
});

test('isBoundBy is true only for a law actually adopted somewhere up the chain', () => {
  const region = { alUnits: { s: { id: 's', kind: 'state' as const, laws: ['theft'] as AlLawId[] } } };
  assert.equal(isBoundBy(region, 's', 'theft'), true);
  assert.equal(isBoundBy({ alUnits: { v: { id: 'v', kind: 'village' as const } } }, 'v', 'theft'), false);
});

test('CRIMINAL_LAWS covers theft, trespass and assault — a real act each, still no fourth', () => {
  assert.deepEqual([...CRIMINAL_LAWS], ['theft', 'trespass', 'assault']);
});

/*
 * succession (DESIGN 6c §3k-i) is a single CHOICE per AL unit, not an
 * adoptable set — innermost-wins-else-inherit-up, the opposite resolution
 * shape from criminal law's union. `standing` (today's actual `holderOf`
 * behaviour) is the default when nothing in the chain ever set one.
 */

test("setSuccessionLaw sets the unit's own choice, replacing any prior one", () => {
  const units = { a: { id: 'a', kind: 'village' as const, succession: 'standing' as SuccessionLawId } };
  assert.equal(setSuccessionLaw(units, 'a', 'stationRank').a.succession, 'stationRank');
});

test("successionOf reads a unit's own choice when it set one", () => {
  const region = { alUnits: { v: { id: 'v', kind: 'village' as const, succession: 'stationRank' as SuccessionLawId } } };
  assert.equal(successionOf(region, 'v'), 'stationRank');
});

test('successionOf inherits from the nearest ancestor that set one', () => {
  const region = { alUnits: {
    s: { id: 's', kind: 'state' as const, succession: 'stationRank' as SuccessionLawId },
    d: { id: 'd', kind: 'district' as const, parent: 's' },
  } };
  assert.equal(successionOf(region, 'd'), 'stationRank');
});

test("a district's own choice overrides its state's, unlike criminal law's union", () => {
  const region = { alUnits: {
    s: { id: 's', kind: 'state' as const, succession: 'stationRank' as SuccessionLawId },
    d: { id: 'd', kind: 'district' as const, parent: 's', succession: 'elective' as SuccessionLawId },
  } };
  assert.equal(successionOf(region, 'd'), 'elective');
});

test('successionOf defaults to standing when nothing in the chain ever set one', () => {
  const region = { alUnits: { v: { id: 'v', kind: 'village' as const } } };
  assert.equal(successionOf(region, 'v'), 'standing');
});
