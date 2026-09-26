import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { playState } from './fixtures.ts';
import { walkTile } from './turn.ts';
import { foldPlay } from './delta.ts';
import { bestPath, drawMap, fieldId, hubId, portalsOf, positionOf } from '../world/map.ts';
import { dateOf, isWinter } from '../world/calendar.ts';
import { linkMinutes } from '../world/travel.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { PlayState } from './state.ts';

/*
 * W4a (DESIGN 6c §2c): the player walks by clicking a tile or a door on the map
 * they stand on — no typing. The same engine walk, charged and stopped the same.
 */

/** In English, so the lines can be read. */
const at = (place: string): PlayState => { const b = playState({ currentPlace: place }); return { ...b, world: { ...b.world, language: 'en' } }; };
const noModel = () => ({ director: new FakeProvider({}), writer: new FakeProvider({}), rng: () => 0.5 });
const here = (s: PlayState) => positionOf(s.world);
const mapHere = (s: PlayState) => drawMap(s.world, here(s).map);
/** A walkable tile a few steps from where you stand. */
function nearby(s: PlayState) {
  const p = here(s);
  const m = mapHere(s);
  for (let d = 3; d < 20; d++) {
    for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) {
      if (m.rows[p.y + dy]?.[p.x + dx] === '.') return { map: p.map, x: p.x + dx, y: p.y + dy };
    }
  }
  throw new Error('no open tile nearby');
}
/** The door on the map you stand on that leads to `to`. */
function doorTo(s: PlayState, to: string) {
  const d = portalsOf(s.world, mapHere(s)).find((p) => 'to' in p && p.to === to);
  if (!d) throw new Error(`no door to ${to} on ${here(s).map}`);
  return { map: here(s).map, x: d.x, y: d.y };
}
/** The same state at hh:mm of an ordinary (not winter) day. */
function atTime(s: PlayState, hour: number, minute: number): PlayState {
  for (let clock = 0; clock < 360 * 144; clock++) {
    const d = dateOf({ ...s.world, clock });
    if (d.hour === hour && d.minute === Math.floor(minute / 10) * 10 && !isWinter({ ...s.world, clock })) {
      return { ...s, world: { ...s.world, clock, second: (minute % 10) * 60 } };
    }
  }
  throw new Error('no such time');
}

test('clicking a tile walks there: charged its best path, no model call, and replays', async () => {
  const s = playState();
  const target = nearby(s);
  const r = await walkTile(noModel(), s, target);
  assert.equal(r.error, null);
  assert.equal(r.record?.delta.walkTo?.stop, 'arrived');
  assert.deepEqual(r.state.world.at, target);
  assert.equal(r.record?.delta.walkTo?.seconds, bestPath(mapHere(s), here(s), target));
  assert.deepEqual(foldPlay(s, [r.record!]).world.at, target);
});

test("clicking a hub's door puts you on the field, at the end that opens onto it", async () => {
  const s = playState();
  const r = await walkTile(noModel(), s, doorTo(s, fieldId('floor-0', 'town', 'market')));
  const field = drawMap(s.world, fieldId('floor-0', 'town', 'market'));
  const end = portalsOf(s.world, field).find((p) => 'to' in p && p.to === hubId('floor-0', 'town'))!;
  assert.deepEqual(r.state.world.at, { map: field.id, x: end.x, y: end.y });
  assert.equal(r.state.world.currentPlace, 'town');
  assert.deepEqual(r.record?.delta.walkTo?.through, []);
});

test("clicking a field's far end enters the next place, on its door", async () => {
  const s = playState();
  const onField = (await walkTile(noModel(), s, doorTo(s, fieldId('floor-0', 'town', 'market')))).state;
  assert.equal(onField.world.at?.map, fieldId('floor-0', 'town', 'market'));
  const r = await walkTile(noModel(), onField, doorTo(onField, hubId('floor-0', 'market')));
  assert.equal(r.state.world.currentPlace, 'market');
  assert.deepEqual(r.record?.delta.walkTo?.through, ['market']);
  assert.equal(r.state.world.at?.map, hubId('floor-0', 'market'));
  assert.equal(r.record?.delta.walkTo?.seconds, 60 * linkMinutes(onField.world, 'town', 'market'));
});

test('DONE: a player crosses a floor, gate to stair, by clicks alone', async () => {
  let s = playState({ currentPlace: 'gate' });
  for (const to of [fieldId('floor-0', 'gate', 'town'), hubId('floor-0', 'town'),
    fieldId('floor-0', 'town', 'stair'), hubId('floor-0', 'stair')]) {
    const r = await walkTile(noModel(), s, doorTo(s, to));
    assert.equal(r.error, null, `toward ${to}`);
    s = r.state;
  }
  assert.equal(s.world.currentPlace, 'stair');
  assert.equal(s.world.at?.map, hubId('floor-0', 'stair'));
});

test('a stair portal walks there, then says to climb', async () => {
  const s = playState({ currentPlace: 'stair', regions: { 'floor-0': groundFloor() } });
  const stair = portalsOf(s.world, mapHere(s)).find((p) => 'region' in p && p.region === 'floor-1')!;
  const r = await walkTile(noModel(), s, { map: here(s).map, x: stair.x, y: stair.y });
  assert.equal(r.error, null);
  assert.deepEqual(r.then, { climb: 'up' });
});

test('a clicked walk stops like a typed one: night on a field', async () => {
  const dusk = atTime(playState(), 19, 58);
  const onField = (await walkTile(noModel(), dusk, doorTo(dusk, fieldId('floor-0', 'town', 'market')))).state;
  assert.equal(onField.world.at?.map, fieldId('floor-0', 'town', 'market'));
  const r = await walkTile(noModel(), onField, doorTo(onField, hubId('floor-0', 'market')));
  assert.equal(r.record?.delta.walkTo?.stop, 'nightfall');
});

test('a click that is not a walkable tile on your map is refused with a reason, and nothing moves', async () => {
  const s = playState();
  const m = mapHere(s);
  const cases: [{ map: string; x: number; y: number }, RegExp][] = [
    [{ map: fieldId('floor-0', 'town', 'market'), x: 1, y: 1 }, /not the map you are on/],
    [{ map: m.id, x: -1, y: 0 }, /outside/],
    [{ map: m.id, x: 0, y: 0 }, /wall/],
  ];
  for (const [bad, why] of cases) {
    const r = await walkTile(noModel(), s, bad);
    assert.match(r.error ?? '', why);
    assert.equal(r.state, s);
    assert.equal(r.record, null);
  }
});

// Found live (session 2ffdec3b): a click onto a field wrote an EMPTY transcript
// entry. Every click says something, and setting out names where the road goes.
test('every click says what happened: setting out names the road, a step names the place', async () => {
  const s = at('town');
  const out = await walkTile(noModel(), s, doorTo(s, fieldId('floor-0', 'town', 'market')));
  assert.match(out.record?.prose ?? '', /the covered market/);
  const step = await walkTile(noModel(), s, nearby(s));
  assert.match(step.record?.prose ?? '', /Ashfall/);
});
