import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { directorOutput, playState } from './fixtures.ts';
import { playTurn } from './turn.ts';
import { foldPlay, validateDelta } from './delta.ts';
import { clockOf, walkRoute } from '../world/travel.ts';
import { groundFloor, link, place } from '../world/fixtures.ts';
import type { World } from '../world/types.ts';
import { isFull } from '../world/types.ts';
import type { PlayState } from './state.ts';

/*
 * 6c maps, before W1 (DESIGN §2d Q1, decided 2026-09-19): typed "go to X" is
 * walked by the ENGINE. The Director refused an adjacent stair three times live
 * and stranded the climber (scripts/probe.ts); movement has one right answer.
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
/** The ordinary turn, for input that is not a walk. */
const scripted = () => ({
  director: new FakeProvider({ structured: [directorOutput()] }),
  writer: new FakeProvider({ text: ['The wind moves over the stones.'] }),
  rng: () => 0.5,
});

// Respecified by W3: the record was `delta.walk`, a list of places, and the clock was
// charged each link's `travelTime`. A walk is now tile by tile on the maps; what it
// charges is pinned in walkmap.test.ts.
test('go to a place two steps away: the engine walks it through every place, with no model call', async () => {
  const start = at('gate', ['town']);
  const r = await playTurn(noModel(), start, 'go to the covered market', 'exploration', []);
  assert.equal(r.state.world.currentPlace, 'market');
  assert.deepEqual(r.record.delta.walkTo?.through, ['town', 'market']);
});

test('a walk replays from its record alone', async () => {
  const start = at('gate', ['town']);
  const r = await playTurn(noModel(), start, 'go to the covered market', 'exploration', []);
  const replayed = foldPlay(start, [r.record]);
  assert.equal(replayed.world.currentPlace, 'market');
  assert.equal(clockOf(replayed.world), clockOf(r.state.world));
});

test('Thai, and any capitalisation', async () => {
  const r = await playTurn(noModel(), at('gate', ['town']), 'ไปที่ the Covered Market', 'exploration', []);
  assert.equal(r.state.world.currentPlace, 'market');
});

test('a place you cannot know of is not walked to: the Director gets the turn', async () => {
  // At the gate with the town unvisited, the market is signposted from nowhere you have been.
  const r = await playTurn(scripted(), at('gate'), 'go to the covered market', 'exploration', []);
  assert.equal(r.record.delta.walkTo, undefined); // Respecified by W3: was `delta.walk`.
});

test('"go to sleep" is speech, not a walk', async () => {
  const r = await playTurn(scripted(), at('town'), 'go to sleep', 'exploration', []);
  assert.equal(r.record.delta.walkTo, undefined); // Respecified by W3: was `delta.walk`.
});

// Respecified by W3: was a proposed `walk: ['market']`.
test('the model cannot propose a walk', () => {
  const walkTo = { map: 'hub:floor-0:market', x: 1, y: 1, seconds: 1, through: ['market'], stop: 'arrived' as const };
  assert.equal(validateDelta(at('town'), { walkTo }).delta.walkTo, undefined);
});

/*
 * Places that share a name (approved 2026-09-19). Live, floor 0 had two places
 * called "Outer Gate" — the entrance and the way up — and "go to Outer Gate"
 * always meant the first, so the climber was walked back to the entrance and
 * never reached the stair.
 */
const twinGates = (): World => {
  const places = link(
    [
      place('gate_in', { kind: 'gate', name: 'Outer Gate', discovered: true }),
      place('harbour', { kind: 'settlement', name: "Harbor's Rest", discovered: true }),
      place('gate_out', { kind: 'gate', name: 'Outer Gate' }),
    ],
    [['gate_in', 'harbour'], ['harbour', 'gate_out']],
  );
  const s = playState();
  return { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...groundFloor(), places, entrance: 'gate_in', exit: 'gate_out' } } };
};
const standingAt = (world: World, placeId: string): World => ({ ...world, currentPlace: placeId });

test('a shared name never means the place you stand in', () => {
  assert.deepEqual(walkRoute(standingAt(twinGates(), 'gate_in'), 'go to Outer Gate'), ['harbour', 'gate_out']);
});

test('a tie between places of one name goes to where you have not been', () => {
  assert.deepEqual(walkRoute(standingAt(twinGates(), 'harbour'), 'go to Outer Gate'), ['gate_out']);
});
