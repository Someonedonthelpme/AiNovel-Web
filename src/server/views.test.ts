import test from 'node:test';
import assert from 'node:assert/strict';
import { floorMapOf, minimapOf, towerOf } from './views.ts';
import { playState } from '../play/fixtures.ts';
import { drawMap, fieldId, positionOf } from '../world/map.ts';
import { groundFloor, person } from '../world/fixtures.ts';
import { dateOf } from '../world/calendar.ts';
import { PLAYER } from '../social/edge.ts';
import type { PlayState } from '../play/state.ts';
import type { Region, World } from '../world/types.ts';

/* W4b (DESIGN 6c §2): the side column is information, not a control. */

const mapHere = (s: PlayState) => drawMap(s.world, positionOf(s.world).map);

test('the minimap is your whole map, shrunk to at most 60 wide, with you on open ground', () => {
  const s = playState();
  const m = mapHere(s);
  const mm = minimapOf(s, m);
  assert.ok(mm.rows[0].length <= 60);
  assert.ok(mm.rows.length <= Math.ceil(m.rows.length * mm.rows[0].length / m.rows[0].length) + 1);
  assert.notEqual(mm.rows[mm.you.y][mm.you.x], '#');
});

test('a field too wide for the minimap is shrunk, and you are still on it', () => {
  const s = playState();
  const field = drawMap(s.world, fieldId('floor-0', 'town', 'market'));
  const [end] = field.ends!;
  const onField = { ...s, world: { ...s.world, at: { map: field.id, x: end.x, y: end.y } } };
  const mm = minimapOf(onField, field);
  assert.ok(field.rows[0].length > 60, 'the fixture must need shrinking');
  assert.ok(mm.rows[0].length <= 60);
  assert.notEqual(mm.rows[mm.you.y][mm.you.x], '#');
});

test('the floor map shows only discovered places and the roads between them', () => {
  const v = floorMapOf(playState({ currentPlace: 'gate' }));
  assert.deepEqual(v.nodes.map((n) => n.id), ['gate'], 'nothing else is discovered yet');
  assert.deepEqual(v.edges, []);
  const been = playState({ currentPlace: 'town' });
  const r = been.world.regions['floor-0'] as Region;
  const w = { ...been, world: { ...been.world, regions: { 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'gate' ? { ...p, discovered: true } : p)) } } } };
  const v2 = floorMapOf(w);
  assert.deepEqual(v2.nodes.map((n) => n.id).sort(), ['gate', 'town']);
  assert.deepEqual(v2.edges.map((e) => [e.from, e.to].sort()), [['gate', 'town']]);
});

/** A world with an era band over floors 21-30, and floors 0, 21 and 22 known. */
function eraWorld(): World {
  const base = playState().world;
  const at = (floor: number): Region => ({ ...groundFloor(), id: `floor-${floor}`, floor, name: `floor ${floor}` });
  return {
    ...base,
    deepestFloor: 22,
    strata: {
      tower: { id: 'tower', name: 'the Tower', kind: 'static', from: 0 },
      eras: { id: 'eras', name: 'the Eras', kind: 'dynamic', parent: 'tower', from: 21, to: 30, laws: { time: 'era' } },
    },
    regions: { 'floor-0': base.regions['floor-0'], 'floor-21': at(21), 'floor-22': at(22) },
  } as World;
}

test('the tower view lists the strata, each era floor with its year, and your deepest floor', () => {
  const w = eraWorld();
  const t = towerOf({ ...playState(), world: w });
  assert.deepEqual(t.strata.map((x) => x.name).sort(), ['the Eras', 'the Tower']);
  assert.deepEqual(t.floors.map((f) => [f.floor, f.era]), [[0, false], [21, true], [22, true]]);
  assert.deepEqual(t.floors.filter((f) => f.era).map((f) => f.year), [21, 22].map((f) => dateOf(w, undefined, f).year));
  assert.equal(t.deepest, 22);
});

test('the tower view lists what you hold', () => {
  const s = playState();
  const r = s.world.regions['floor-0'] as Region;
  const held = { ...s, world: { ...s.world, regions: { 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: PLAYER } : p)) } } } };
  assert.deepEqual(towerOf(held).held, ['Ashfall']);
});

test('a grudge on the road shows only if you have met them, and never where they are', () => {
  const s = playState();
  const people = {
    ...s.world.people,
    smith: { ...s.world.people.smith, lastSeenTurn: 3 },
    stranger: person('stranger', { name: 'a stranger', lastSeenTurn: 0 }),
  };
  const journeys = ['smith', 'stranger'].map((who) => ({ who, for: who, region: 'floor-0', place: 'gate', progress: 0, departs: 0 }));
  const t = towerOf({ ...s, world: { ...s.world, people, journeys } });
  assert.deepEqual(t.grudges, [{ name: 'Ora the smith' }]);
});
