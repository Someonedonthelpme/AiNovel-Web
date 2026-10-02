import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingsFor } from './buildinggen.ts';
import { shiftOf } from './workstation.ts';
import { CAPS, occupiedModulesOf, SETTLEMENT_TIERS } from './settlement.ts';
import { groundFloor, place } from './fixtures.ts';
import type { Place, World } from './types.ts';

/*
 * DESIGN 6c §3i (the smallest slice): nothing generated ever had a building, so the whole
 * station system was unreachable in a real world. Every settlement gets a hall; economic
 * buildings come by tier. Engine-only, deterministic, from state alone.
 */

const worldWith = (places: Place[]): Pick<World, 'seed' | 'regions'> =>
  ({ seed: 1, regions: { 'floor-0': { ...groundFloor(), places } } });
const deal = (places: Place[]): Place[] => buildingsFor(worldWith(places), 'floor-0', places);
const settlementOf = (tier: (typeof SETTLEMENT_TIERS)[number]): Place => place('s', { kind: 'settlement', tier });
const idsOf = (p: Place) => (p.buildings ?? []).map((b) => b.id).sort();

test('every settlement gets exactly one hall with an administrative workstation; nothing else does', () => {
  const dealt = deal([settlementOf('town'), place('w', { kind: 'wild' }), place('g', { kind: 'gate' }), place('l', { kind: 'landmark' })]);
  const halls = (p: Place) => (p.buildings ?? []).filter((b) => b.workstations?.some((w) => w.subkind === 'administrative'));
  assert.equal(halls(dealt.find((p) => p.id === 's')!).length, 1);
  for (const id of ['w', 'g', 'l']) assert.equal(dealt.find((p) => p.id === id)!.buildings, undefined, `${id} is not a settlement`);
});

// respecified: the catalogue grew by home, inn, farmstead and tannery (DESIGN 6c §3i). Intent is unchanged —
// buildings come by tier and never exceed the plot budget — only the expected lists moved.
const IDS_BY_TIER: Record<(typeof SETTLEMENT_TIERS)[number], string[]> = {
  hamlet: ['hall-1', 'home-1', 'pasture-1'],
  village: ['farmstead-1', 'hall-1', 'home-1', 'inn-1', 'pasture-1', 'smithy-1'],
  town: ['farmstead-1', 'hall-1', 'home-1', 'inn-1', 'pasture-1', 'smithy-1', 'tannery-1'],
  city: ['farmstead-1', 'hall-1', 'home-1', 'inn-1', 'pasture-1', 'smithy-1', 'tannery-1'],
  metropolis: ['farmstead-1', 'hall-1', 'home-1', 'inn-1', 'pasture-1', 'smithy-1', 'tannery-1'],
  megacity: ['farmstead-1', 'hall-1', 'home-1', 'inn-1', 'pasture-1', 'smithy-1', 'tannery-1'],
};

test('buildings come by tier and never exceed the tier\'s plot budget', () => {
  for (const tier of SETTLEMENT_TIERS) {
    const built = deal([settlementOf(tier)])[0];
    assert.deepEqual(idsOf(built), IDS_BY_TIER[tier], tier);
    assert.ok(occupiedModulesOf(built) <= CAPS[tier].plots, `${tier} fits its plots`);
  }
});

test('the service buildings serve a need and the economic ones start supplied', () => {
  const built = deal([settlementOf('town')])[0].buildings ?? [];
  const station = (b: string, w: string) => built.find((x) => x.id === b)?.workstations?.find((x) => x.id === w);
  assert.equal(station('home-1', 'bed')?.subkind, 'service');
  assert.deepEqual(station('inn-1', 'hearth')?.serviceMethod?.output, [{ need: 'rest', amount: 3 }]);
  assert.deepEqual(built.find((b) => b.id === 'farmstead-1')?.container, { seed: 4 });
  assert.deepEqual(built.find((b) => b.id === 'tannery-1')?.container, { material: 4 });
});

test('every dealt workstation can be run: a method, a serviceMethod, or the hall\'s desk', () => {
  for (const w of deal([settlementOf('town')])[0].buildings!.flatMap((b) => b.workstations ?? [])) {
    assert.ok(w.method || w.serviceMethod || w.subkind === 'administrative', `${w.id} is runnable`);
  }
});

test('dealing is deterministic and ids are unique inside a place', () => {
  const places = [settlementOf('city'), place('t', { kind: 'settlement', tier: 'village' })];
  assert.deepEqual(deal(places), deal(places));
  for (const p of deal(places)) assert.equal(new Set(idsOf(p)).size, idsOf(p).length, p.id);
});

test('the smithy starts stocked, the pasture empty, and nothing has been visited yet', () => {
  const built = deal([settlementOf('town')])[0].buildings ?? [];
  assert.deepEqual(built.find((b) => b.id === 'smithy-1')?.container, { material: 4 });
  assert.deepEqual(built.find((b) => b.id === 'pasture-1')?.container, {});
  for (const b of built) assert.equal((b as { workedAt?: number }).workedAt, undefined, `${b.id} is stamped on first sighting, not at birth`);
});

test('dealt buildings carry their category and shift', () => {
  const by = Object.fromEntries(deal([settlementOf('town')])[0].buildings!.map((b) => [b.id, [b.category, shiftOf(b)]]));
  assert.deepEqual(by, {
    'hall-1': ['government', 'day'], 'pasture-1': ['agriculture', 'day'], 'smithy-1': ['production', 'day'],
    'farmstead-1': ['agriculture', 'day'], 'inn-1': ['amenities', 'both'], 'home-1': ['residential', 'night'],
    'tannery-1': ['production', 'day'],
  });
});
