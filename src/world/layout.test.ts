import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_SIZE, layoutRegion, mapEdges } from './layout.ts';
import { groundFloor, link, place } from './fixtures.ts';

test('every place gets a position', () => {
  const region = groundFloor();
  const positions = layoutRegion(region);
  assert.equal(positions.length, region.places.length);
});

test('positions stay inside the viewBox', () => {
  for (const p of layoutRegion(groundFloor())) {
    assert.ok(p.x >= 0 && p.x <= LAYOUT_SIZE, `x out of range: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= LAYOUT_SIZE, `y out of range: ${p.y}`);
  }
});

test('the entrance sits at the near edge and depth grows away from it', () => {
  const positions = layoutRegion(groundFloor());
  const entrance = positions.find((p) => p.id === 'gate');
  const far = positions.find((p) => p.id === 'market');
  assert.equal(entrance?.depth, 0);
  assert.ok((far?.depth ?? 0) > 0);
  assert.ok((far?.x ?? 0) > (entrance?.x ?? 0), 'the map should read left to right');
});

test('layout is deterministic — the map must not rearrange itself while read', () => {
  assert.deepEqual(layoutRegion(groundFloor()), layoutRegion(groundFloor()));
});

test('discovering a place does not move the others', () => {
  const before = layoutRegion(groundFloor());
  const region = groundFloor();
  region.places = region.places.map((p) => (p.id === 'well' ? { ...p, discovered: true } : p));
  assert.deepEqual(layoutRegion(region), before);
});

test('places in the same layer do not overlap', () => {
  const positions = layoutRegion(groundFloor());
  const seen = new Set<string>();
  for (const p of positions) {
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    assert.equal(seen.has(key), false, `two places share ${key}`);
    seen.add(key);
  }
});

test('an unreachable place is still drawn, past the far edge', () => {
  const region = groundFloor();
  region.places = [...region.places, place('vault')];
  const positions = layoutRegion(region);
  const vault = positions.find((p) => p.id === 'vault');
  assert.ok(vault, 'an orphan must not vanish from the map');
  assert.ok(vault.depth > 0);
});

test('a single-place region is centred rather than crammed into a corner', () => {
  const region = { ...groundFloor(), places: [place('alone')], entrance: 'alone', exit: null };
  const [only] = layoutRegion(region);
  assert.equal(only.x, LAYOUT_SIZE / 2);
  assert.equal(only.y, LAYOUT_SIZE / 2);
});

test('an empty region lays out to nothing rather than throwing', () => {
  assert.deepEqual(layoutRegion({ ...groundFloor(), places: [] }), []);
});

test('each connection is drawn once, not twice', () => {
  const edges = mapEdges(groundFloor());
  const keys = edges.map((e) => [e.from, e.to].sort().join(' '));
  assert.equal(new Set(keys).size, keys.length, 'an undirected edge must not be duplicated');
  assert.equal(edges.length, 4, 'the ground floor has four corridors');
});

test('edges only reference places that exist', () => {
  const region = groundFloor();
  const ids = new Set(region.places.map((p) => p.id));
  for (const edge of mapEdges(region)) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), `dangling edge ${edge.from}->${edge.to}`);
  }
});
