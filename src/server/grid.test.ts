import test from 'node:test';
import assert from 'node:assert/strict';
import { gridOf } from './grid.ts';
import { playState } from '../play/fixtures.ts';
import { drawMap, fieldId, positionOf } from '../world/map.ts';
import { activeRegion, signposted } from '../world/travel.ts';
import type { PlayState } from '../play/state.ts';

/* W4a: the centre view — a window of the map you stand on, and its doors. */

const mapHere = (s: PlayState) => drawMap(s.world, positionOf(s.world).map);

test('the grid is a window of your map around you, clipped to its edges', () => {
  const s = playState();
  const m = mapHere(s);
  const g = gridOf(s, m);
  const you = positionOf(s.world);
  assert.ok(g.rows.length <= 25 && g.rows[0].length <= 41);
  assert.deepEqual(g.you, { x: you.x, y: you.y });
  assert.equal(g.rows[g.you.y - g.y0][g.you.x - g.x0], m.rows[you.y][you.x]);
  assert.ok(g.x0 >= 0 && g.y0 >= 0 && g.x0 + g.rows[0].length <= m.rows[0].length && g.y0 + g.rows.length <= m.rows.length);
});

test('every door on the map is sent, the stairs marked, and labelled only with names you could know', () => {
  const s = playState({ currentPlace: 'gate' });
  const g = gridOf(s, mapHere(s));
  assert.equal(g.doors.find((d) => d.to === fieldId('floor-0', 'gate', 'town'))?.label, 'Ashfall');
  assert.ok(g.doors.some((d) => d.stair === 'down'), 'the gate is the way down');
  const region = activeRegion(s.world)!;
  const known = new Set(region.places
    .filter((p) => signposted(region, s.world.currentPlace).has(p.id) || p.discovered || p.id === s.world.currentPlace)
    .map((p) => p.name));
  for (const d of g.doors) if (d.label !== null && !d.stair) assert.ok(known.has(d.label), d.label);
});
