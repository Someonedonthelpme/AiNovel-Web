import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { directorOutput, playState } from './fixtures.ts';
import { playTurn } from './turn.ts';
import { foldPlay, validateDelta } from './delta.ts';
import { clockOf, travelTime } from '../world/travel.ts';
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

test('go to a place two steps away: the engine walks it, charging each step, with no model call', async () => {
  const start = at('gate', ['town']);
  const r = await playTurn(noModel(), start, 'go to the covered market', 'exploration', []);
  assert.equal(r.state.world.currentPlace, 'market');
  assert.deepEqual(r.record.delta.walk, ['town', 'market']);
  const w = start.world;
  assert.equal(clockOf(r.state.world) - clockOf(w), travelTime(w, 'gate', 'town') + travelTime(w, 'town', 'market'));
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
  assert.equal(r.record.delta.walk, undefined);
});

test('"go to sleep" is speech, not a walk', async () => {
  const r = await playTurn(scripted(), at('town'), 'go to sleep', 'exploration', []);
  assert.equal(r.record.delta.walk, undefined);
});

test('the model cannot propose a walk', () => {
  assert.equal(validateDelta(at('town'), { walk: ['market'] }).delta.walk, undefined);
});
