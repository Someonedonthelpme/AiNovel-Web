import test from 'node:test';
import assert from 'node:assert/strict';
import { reachablePlaces, validateRegion } from './validate.ts';
import { groundFloor, link, place, world } from './fixtures.ts';
import type { Region } from './types.ts';

const people = world().people;
const codes = (r: Region) => validateRegion(r, people).errors.map((e) => e.code);

test('a well-formed region passes', () => {
  const r = validateRegion(groundFloor(), people);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors, null, 2));
  assert.equal(r.ok, true);
  assert.equal(r.unreachable.length, 0);
});

test('every place is reachable from the entrance', () => {
  const reached = reachablePlaces(groundFloor());
  assert.deepEqual([...reached].sort(), ['gate', 'market', 'stair', 'town', 'well']);
});

test('a connection to a place that does not exist is caught', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.id === 'well' ? { ...p, connections: [...p.connections, 'nowhere'] } : p));
  assert.ok(codes(r).includes('DANGLING_CONNECTION'));
});

test('a one-way corridor is caught — that is how players get stranded', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.id === 'town' ? { ...p, connections: p.connections.filter((c) => c !== 'well') } : p));
  assert.ok(codes(r).includes('ASYMMETRIC_CONNECTION'));
});

test('a place connected to itself is caught', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.id === 'well' ? { ...p, connections: [...p.connections, 'well'] } : p));
  assert.ok(codes(r).includes('SELF_CONNECTION'));
});

test('an unreachable way up is an error, not a warning — the player would be trapped', () => {
  const r = groundFloor();
  // Sever the stair from the rest of the region.
  r.places = r.places.map((p) => {
    if (p.id === 'stair') return { ...p, connections: [] };
    return { ...p, connections: p.connections.filter((c) => c !== 'stair') };
  });
  const result = validateRegion(r, people);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'EXIT_UNREACHABLE'));
  assert.deepEqual(result.unreachable, ['stair']);
});

test('an entrance that is not a place in the region is caught', () => {
  const r = { ...groundFloor(), entrance: 'elsewhere' };
  assert.ok(codes(r).includes('MISSING_ENTRANCE'));
});

test('an exit that is not a place in the region is caught', () => {
  const r = { ...groundFloor(), exit: 'elsewhere' };
  assert.ok(codes(r).includes('MISSING_EXIT'));
});

test('a region with no way up yet is still valid', () => {
  const r = { ...groundFloor(), exit: null };
  assert.equal(validateRegion(r, people).ok, true, 'the stair simply has not been found');
});

test('a person who is not in the registry is caught', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.id === 'well' ? { ...p, people: ['ghost'] } : p));
  assert.ok(codes(r).includes('DANGLING_PERSON'));
});

test('duplicate place ids are caught', () => {
  const r = groundFloor();
  r.places = [...r.places, r.places[0]];
  assert.ok(codes(r).includes('DUPLICATE_PLACE_ID'));
});

test('an orphan place warns but does not fail the region', () => {
  const r = groundFloor();
  r.places = [...r.places, place('attic')];
  const result = validateRegion(r, people);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === 'ORPHAN_PLACES'));
  assert.deepEqual(result.unreachable, ['attic']);
});

test('a place with nothing to do warns, because the Director would have to invent', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.id === 'well' ? { ...p, affordances: [] } : p));
  assert.ok(validateRegion(r, people).warnings.some((w) => w.code === 'NO_AFFORDANCES'));
});

test('an oversized floor warns against its depth budget', () => {
  const r = groundFloor();
  const extra = Array.from({ length: 20 }, (_, i) => place(`x${i}`));
  r.places = link([...r.places, ...extra], extra.map((p) => ['town', p.id] as [string, string]));
  const result = validateRegion(r, people);
  assert.equal(result.ok, true, 'budgets are guidance, not hard failures');
  assert.ok(result.warnings.some((w) => w.code === 'PLACE_COUNT_OFF_BUDGET'));
});

test('ground level must have exactly one settlement', () => {
  const r = groundFloor();
  r.places = r.places.map((p) => (p.kind === 'settlement' ? { ...p, kind: 'wild' as const } : p));
  assert.ok(validateRegion(r, people).warnings.some((w) => w.code === 'SETTLEMENT_COUNT_OFF_BUDGET'));
});
