import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../llm/provider.ts';
import { directorOutput, playState } from './fixtures.ts';
import { playTurn } from './turn.ts';
import { foldPlay } from './delta.ts';
import { fightOpen } from './combat.ts';
import { firstFloor, groundFloor } from '../world/fixtures.ts';
import type { PlayState } from './state.ts';
import { speciesFor } from '../character/species.ts';

/*
 * Fight and rest, engine-side (decided with the user, 2026-09-19): the probe
 * found the Director starting no fight on five of six "attack" turns, and rest
 * reachable only if the model proposed it. A step with one right answer is the
 * engine's, like a typed walk. Only HUNTING starts a fight here; "attack the
 * guard" is a social act and stays the Director's.
 */

/** A provider that throws on any call: these turns must never reach the model. */
const noModel = () => ({ director: new FakeProvider({}), writer: new FakeProvider({}), rng: () => 0.5 });
const scripted = () => ({
  director: new FakeProvider({ structured: [directorOutput()] }),
  writer: new FakeProvider({ text: ['"ครับ ผมเข้าใจครับ"'] }),
  rng: () => 0.5,
});

const hurt = (s: PlayState): PlayState => ({ ...s, pc: { ...s.pc, hp: 1 } });
const hurtInTown = () => hurt(playState({ currentPlace: 'town' }));
const hurtOnFloor5Unheld = (): PlayState => {
  const s = hurtInTown();
  const r = s.world.regions['floor-0'];
  return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, floor: 5 } } } };
};
const inTown = () => playState({ currentPlace: 'town' });
const onFloor1 = () => playState({
  currentRegion: 'floor-1',
  currentPlace: 'landing',
  regions: { 'floor-0': { ...groundFloor(), exit: null }, 'floor-1': firstFloor() },
});

/* rest ----------------------------------------------------------------------- */

test('"rest" is a short rest the engine takes, with no model call, and it heals', async () => {
  const rested = await playTurn(noModel(), hurtInTown(), 'rest', 'exploration', []);
  assert.equal(rested.record.delta.rest, 'short');
  assert.ok(rested.state.pc.hp > hurtInTown().pc.hp, 'it healed');
});

test('"sleep" is a long rest, and Thai works', async () => {
  assert.equal((await playTurn(noModel(), hurtInTown(), 'sleep', 'exploration', [])).record.delta.rest, 'long');
  assert.equal((await playTurn(noModel(), hurtInTown(), 'พัก', 'exploration', [])).record.delta.rest, 'short');
});

test('a rest the rules forbid is refused with their reason, and no model call', async () => {
  const refused = await playTurn(noModel(), hurtOnFloor5Unheld(), 'long rest', 'exploration', []);
  assert.equal(refused.record.delta.rest, undefined);
  assert.match(refused.rejected.join(' '), /town/, 'the reason canRest gives');
});

test('a rest replays from its record', async () => {
  const rested = await playTurn(noModel(), hurtInTown(), 'rest', 'exploration', []);
  assert.equal(foldPlay(hurtInTown(), [rested.record]).pc.hp, rested.state.pc.hp);
});

/* fight ---------------------------------------------------------------------- */

test('"hunt" starts a fight where something hunts, with no model call', async () => {
  const hunt = await playTurn(noModel(), onFloor1(), 'hunt', 'exploration', []);
  assert.equal(hunt.record.delta.startCombat, true);
  assert.ok(fightOpen(hunt.state));
});

test('"hunt" on the ground floor is refused with the reason', async () => {
  const ground = await playTurn(noModel(), inTown(), 'hunt', 'exploration', []);
  assert.match(ground.rejected.join(' '), /nothing hunts at ground level/);
  assert.equal(fightOpen(ground.state), false);
});

/* speech stays speech -------------------------------------------------------- */

test('"rest assured" and "attack the warden" are the Director\'s', async () => {
  assert.equal((await playTurn(scripted(), inTown(), 'rest assured, I will help', 'conversation', [])).record.delta.rest, undefined);
  assert.equal((await playTurn(scripted(), inTown(), 'attack the warden', 'conversation', [])).record.delta.startCombat, undefined);
});

/*
 * A hunt that finds nothing says so (approved 2026-09-19). Live, a place was
 * hunted out — kills thin a crowd, and a thinned crowd stays gone — and every
 * later "hunt" was accepted, opened no fight, and still said "You go looking for
 * trouble." The world was right; the player was told nothing.
 */
const withKinds = (s: PlayState): PlayState => ({ ...s, world: { ...s.world, species: speciesFor(11) } });
const huntedOut = (): PlayState => {
  const s = withKinds(onFloor1());
  // English, so the line is the English one; the Thai line is the same check.
  return { ...s, world: { ...s.world, language: 'en', populations: { ...s.world.populations, landing: [] } } };
};

test('a hunt in a place hunted out says so, and no fight is recorded', async () => {
  const r = await playTurn(noModel(), huntedOut(), 'hunt', 'exploration', []);
  assert.equal(fightOpen(r.state), false);
  assert.match(r.record.prose, /nothing here is left to hunt/i);
  assert.match(r.rejected.join(' '), /nothing left to hunt/);
  assert.equal(r.record.delta.startCombat, undefined, 'no fight is recorded as started');
});

test('a place with a crowd still hunts as before', async () => {
  assert.ok(fightOpen((await playTurn(noModel(), withKinds(onFloor1()), 'hunt', 'exploration', [])).state));
});
