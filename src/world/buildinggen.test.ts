import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingsFor } from './buildinggen.ts';
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

test('economic buildings come by tier and never exceed the tier\'s plot budget', () => {
  for (const tier of SETTLEMENT_TIERS.filter((t) => t !== 'metropolis' && t !== 'megacity')) {
    const built = deal([settlementOf(tier)])[0];
    assert.deepEqual(idsOf(built), tier === 'hamlet' ? ['hall-1', 'pasture-1'] : ['hall-1', 'pasture-1', 'smithy-1'], tier);
    assert.ok(occupiedModulesOf(built) <= CAPS[tier].plots, `${tier} fits its plots`);
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
