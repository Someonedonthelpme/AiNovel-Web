import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { playState } from './fixtures.ts';
import { playTurn } from './turn.ts';
import { applyDelta, foldPlay, validateDelta } from './delta.ts';
import { bestPath, drawMap, fieldId, hubId, portalsOf, positionOf } from '../world/map.ts';
import type { GameMap } from '../world/map.ts';
import { clockOf, linkMinutes } from '../world/travel.ts';
import { dateOf, isWinter } from '../world/calendar.ts';
import { isFull } from '../world/types.ts';
import type { World } from '../world/types.ts';
import type { PlayState } from './state.ts';
import { metNeeds } from '../character/persona.ts';

/*
 * W3 (DESIGN 6c §2c): a walk crosses the maps tile by tile, is charged per tile,
 * stops at the first thing that matters, and replays from its record alone.
 */

/** Standing at `place`; `beenTo` places are already discovered. */
const at = (place: string, beenTo: string[] = []): PlayState => {
  const s = playState({ currentPlace: place });
  const r = s.world.regions['floor-0'];
  assert.ok(isFull(r));
  const places = r.places.map((p) => (beenTo.includes(p.id) ? { ...p, discovered: true } : p));
  return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, places } } } };
};
/** A provider that throws on any call: a walk must never reach the model. */
const noModel = () => ({ director: new FakeProvider({}), writer: new FakeProvider({}), rng: () => 0.5 });

const S = (w: World, a: string, b: string) => 60 * linkMinutes(w, a, b);
const hub = (w: World, p: string) => drawMap(w, hubId('floor-0', p));
const door = (w: World, p: string, to: string) =>
  portalsOf(w, hub(w, p)).find((d) => 'to' in d && d.to === fieldId('floor-0', p, to))!;
const cell = (c: { x: number; y: number }) => ({ x: c.x, y: c.y });
const centre = (m: GameMap) => ({ x: Math.floor(m.rows[0].length / 2), y: Math.floor(m.rows.length / 2) });
const secondsOf = (w: World) => clockOf(w) * 600 + (w.second ?? 0);

/** The first clock on or after `from` that satisfies `ok`, and not in winter. */
function clockWhere(s: PlayState, ok: (clock: number) => boolean): number {
  for (let clock = 0; clock < 360 * 144; clock++) {
    if (ok(clock) && !isWinter({ ...s.world, clock })) return clock;
  }
  throw new Error('no such clock');
}
/** The same state at `hh:mm` of an ordinary day. */
function atTime(s: PlayState, hour: number, minute: number): PlayState {
  const clock = clockWhere(s, (c) => { const d = dateOf({ ...s.world, clock: c }); return d.hour === hour && d.minute === Math.floor(minute / 10) * 10; });
  return { ...s, world: { ...s.world, clock, second: (minute % 10) * 60 } };
}

test('go to a place two links away: walked tile by tile, every tile charged, no model call', async () => {
  const start = at('gate', ['town']);
  const w = start.world;
  const r = await playTurn(noModel(), start, 'go to the covered market', 'exploration', []);
  const expected = bestPath(hub(w, 'gate'), centre(hub(w, 'gate')), door(w, 'gate', 'town'))
    + S(w, 'gate', 'town')
    + bestPath(hub(w, 'town'), door(w, 'town', 'gate'), door(w, 'town', 'market'))
    + S(w, 'town', 'market');
  assert.equal(r.record.delta.walkTo?.seconds, expected);
  assert.equal(secondsOf(r.state.world) - secondsOf(w), expected);
  assert.deepEqual(r.record.delta.walkTo?.through, ['town', 'market']);
  assert.equal(r.record.delta.walkTo?.stop, 'arrived');
  assert.equal(r.state.world.currentPlace, 'market');
  assert.deepEqual(r.state.world.at, { map: hubId('floor-0', 'market'), ...cell(door(w, 'market', 'town')) });
});

test('seconds carry across walks: two half-ticks make one tick', () => {
  const s = playState();
  const half = { map: hubId('floor-0', 'town'), x: 1, y: 1, seconds: 300, through: [], stop: 'arrived' as const };
  const twice = applyDelta(applyDelta(s, { walkTo: half }), { walkTo: half });
  assert.equal(clockOf(twice.world) - clockOf(s.world), 1);
  assert.equal(twice.world.second ?? 0, s.world.second ?? 0);
});

test('a walk replays to the same stop without pathfinding', async () => {
  const start = at('gate', ['town']);
  const r = await playTurn(noModel(), start, 'go to the covered market', 'exploration', []);
  const replayed = foldPlay(start, [r.record]);
  const view = (s: PlayState) => [s.world.at, clockOf(s.world), s.world.second, s.world.currentPlace];
  assert.deepEqual(view(replayed), view(r.state));
  // The fold never looks at tiles: a stop on what the generator calls a wall folds to exactly there.
  const wall = { map: hubId('floor-0', 'town'), x: 0, y: 0, seconds: 42, through: [], stop: 'arrived' as const };
  assert.equal(hub(start.world, 'town').rows[0][0], '#');
  assert.deepEqual(applyDelta(start, { walkTo: wall }).world.at, { map: wall.map, x: 0, y: 0 });
});

test('nightfall stops a walk on a field; walking on is allowed', async () => {
  const dusk = atTime(at('town'), 19, 58);
  const r = await playTurn(noModel(), dusk, 'go to the dry well', 'exploration', []);
  assert.equal(r.record.delta.walkTo?.stop, 'nightfall');
  assert.equal(r.state.world.at?.map, fieldId('floor-0', 'town', 'well'));
  assert.equal(r.state.world.currentPlace, 'town', 'still where you set out from');
  const on = await playTurn(noModel(), r.state, 'go to the dry well', 'exploration', []);
  assert.equal(on.record.delta.walkTo?.stop, 'arrived');
  assert.equal(on.state.world.currentPlace, 'well');
});

test('the same walk at noon arrives', async () => {
  const r = await playTurn(noModel(), atTime(at('town'), 12, 0), 'go to the dry well', 'exploration', []);
  assert.equal(r.record.delta.walkTo?.stop, 'arrived');
});

test('a need falling to its threshold stops the walk at that tick', async () => {
  const base = at('gate', ['town']);
  // Ten seconds before a food mark (every 4 hours), with food one above the line.
  const clock = clockWhere(base, (c) => (c + 1) % 24 === 0);
  const s: PlayState = {
    ...base,
    world: { ...base.world, clock, second: 590 },
    sheet: { ...base.sheet, needs: { ...(base.sheet.needs ?? metNeeds()), food: 4 } },
  };
  const r = await playTurn(noModel(), s, 'go to the covered market', 'exploration', []);
  assert.equal(r.record.delta.walkTo?.stop, 'hungry');
  assert.equal(r.state.sheet.needs?.food, 3);
  assert.ok(r.record.delta.walkTo!.seconds < 600, 'stopped at the first tick, not the end');
});

test('the model cannot walk the player', () => {
  const walkTo = { map: hubId('floor-0', 'market'), x: 1, y: 1, seconds: 1, through: ['market'], stop: 'arrived' as const };
  assert.equal(validateDelta(at('town'), { walkTo }).delta.walkTo, undefined);
});

test('the walk reads maps through deps.mapOf — the stored copy, not a fresh draw', async () => {
  const asked: string[] = [];
  const start = at('gate', ['town']);
  const deps = { ...noModel(), mapOf: (id: string) => { asked.push(id); return drawMap(start.world, id); } };
  await playTurn(deps, start, 'go to the covered market', 'exploration', []);
  assert.deepEqual([...new Set(asked)].sort(), [hubId('floor-0', 'gate'), fieldId('floor-0', 'gate', 'town'), hubId('floor-0', 'town'),
    fieldId('floor-0', 'town', 'market'), hubId('floor-0', 'market')].sort());
});

test('with no position you stand at the centre of your place', () => {
  const s = playState();
  assert.equal(s.world.at, undefined);
  assert.deepEqual(positionOf(s.world), { map: hubId('floor-0', 'town'), ...centre(hub(s.world, 'town')) });
});
