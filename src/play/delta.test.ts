import { axisOf, PLAYER, trustToward } from '../social/edge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, foldPlay, validateDelta } from './delta.ts';
import { playState } from './fixtures.ts';
import { forbids } from '../rules/ruleset.ts';
import type { TurnRecord, WorldDelta } from './state.ts';

const record = (delta: WorldDelta): TurnRecord => ({
  kind: 'turn', input: 'x', mode: 'conversation', classification: 'NEUTRAL',
  addressed: null, roll: null, delta, rejected: [], prose: '',
});

/** A turn where the player speaks to someone, and how they speak matters. */
const spokenTo = (who: string, input: string, delta: WorldDelta = {}): TurnRecord => ({
  kind: 'turn', input, mode: 'conversation', classification: 'NEUTRAL',
  addressed: who, roll: null, delta, rejected: [], prose: '',
});

/* -------------------------------------------------------------------------- */
/* Validation — the engine is the trust boundary                               */
/* -------------------------------------------------------------------------- */

test('a move along a real edge is allowed', () => {
  const s = playState();
  const r = validateDelta(s, { moveTo: 'market' });
  assert.deepEqual(r.rejected, []);
  assert.equal(r.delta.moveTo, 'market');
});

test('a move to a place that is not connected is refused with a reason', () => {
  const s = playState();
  const r = validateDelta(s, { moveTo: 'gate' === s.world.currentPlace ? 'market' : 'nowhere' });
  assert.equal(r.delta.moveTo, undefined);
  assert.match(r.rejected[0], /not connected/);
});

test('moving to where you already stand is refused', () => {
  const s = playState();
  const r = validateDelta(s, { moveTo: s.world.currentPlace });
  assert.match(r.rejected[0], /already there/);
});

test('refusing one field does not discard the rest of the turn', () => {
  const s = playState();
  const r = validateDelta(s, { moveTo: 'atlantis', learnFacts: ['the well is dry'], trust: { smith: 1 } });
  assert.equal(r.rejected.length, 1);
  assert.deepEqual(r.delta.learnFacts, ['the well is dry']);
  assert.deepEqual(r.delta.trust, { smith: 1 });
});

test('trust for someone who does not exist is refused', () => {
  const r = validateDelta(playState(), { trust: { nobody: 2 } });
  assert.equal(r.delta.trust, undefined);
  assert.match(r.rejected[0], /no such person/);
});

test('a single turn cannot swing a relationship end to end', () => {
  const r = validateDelta(playState(), { trust: { smith: 99 } });
  assert.equal(r.delta.trust?.smith, 3);
  assert.match(r.rejected[0], /capped/);
});

test('revealing an exit that is not a place in this region is refused', () => {
  const r = validateDelta(playState(), { revealExit: 'elsewhere' });
  assert.equal(r.delta.revealExit, undefined);
  assert.match(r.rejected[0], /no such place/);
});

test('time spent is clamped to a sane per-turn budget', () => {
  assert.equal(validateDelta(playState(), { timeSpent: 99 }).delta.timeSpent, 3);
  assert.equal(validateDelta(playState(), { timeSpent: -5 }).delta.timeSpent, 0);
});

test('blank facts are dropped rather than stored', () => {
  const r = validateDelta(playState(), { learnFacts: ['  ', '', 'a real fact'] });
  assert.deepEqual(r.delta.learnFacts, ['a real fact']);
});

/* -------------------------------------------------------------------------- */
/* Application                                                                 */
/* -------------------------------------------------------------------------- */

test('every turn advances the clock exactly once, with or without a move', () => {
  const s = playState();
  assert.equal(applyDelta(s, { moveTo: 'market' }).world.turn, s.world.turn + 1);
  assert.equal(applyDelta(s, {}).world.turn, s.world.turn + 1, 'a turn without a move still costs a turn');
});

test('trust changes are relative, land on the EDGE, and clamp to the band', () => {
  const s = playState();
  const up = applyDelta(s, { trust: { smith: 2 } });
  assert.equal(trustToward(up.world.edges, 'smith'), 2);

  const capped = applyDelta(up, { trust: { smith: 99 } });
  assert.equal(trustToward(capped.world.edges, 'smith'), 4, 'cannot exceed the top band');

  const floored = applyDelta(s, { trust: { warden: -99 } });
  assert.equal(trustToward(floored.world.edges, 'warden'), -3);
});

test("a trust change moves THEIR edge and leaves the player's own view alone", () => {
  // The thing one number could never say. She may think well of him while he
  // has not formed an opinion at all.
  const after = applyDelta(playState(), { trust: { smith: 3 } });
  assert.equal(axisOf(after.world.edges, 'smith', PLAYER, 'trust'), 3);
  assert.equal(axisOf(after.world.edges, PLAYER, 'smith', 'trust'), 0, 'the other direction is its own edge');
});

test('learned facts become canon, once', () => {
  const s = playState();
  const once = applyDelta(s, { learnFacts: ['the well is dry'] });
  assert.equal(once.world.facts.length, 1);
  assert.equal(once.world.facts[0].text, 'the well is dry');

  const twice = applyDelta(once, { learnFacts: ['the well is dry'] });
  assert.equal(twice.world.facts.length, 1, 'the same truth is not established twice');
});

test('revealing the exit makes the way up known', () => {
  const s = playState();
  assert.equal(s.world.regions['floor-0'].detail === 'full' && s.world.regions['floor-0'].exit, null);
  const found = applyDelta(s, { revealExit: 'stair' });
  const region = found.world.regions['floor-0'];
  assert.equal(region.detail === 'full' && region.exit, 'stair');
});

test('the way up cannot be relocated once it is known', () => {
  // Regression: the Director quietly moved the staircase. The local map went on
  // labelling the Tower Stair while the real exit had become the gate out of
  // town, so the floor could not be climbed from anywhere the player was told
  // to stand — the tower was sealed.
  const found = applyDelta(playState(), { revealExit: 'stair' });

  const moved = validateDelta(found, { revealExit: 'gate' });
  assert.equal(moved.delta.revealExit, undefined);
  assert.match(moved.rejected[0], /already known/);

  const region = applyDelta(found, moved.delta).world.regions['floor-0'];
  assert.equal(region.detail === 'full' && region.exit, 'stair', 'and the stair is still the stair');
});

test('re-revealing the exit that is already known is harmless', () => {
  const found = applyDelta(playState(), { revealExit: 'stair' });
  const again = validateDelta(found, { revealExit: 'stair' });
  assert.deepEqual(again.rejected, []);
  assert.equal(again.delta.revealExit, 'stair');
});

test('flags merge rather than replace', () => {
  const s = applyDelta(playState(), { flags: { a: true } });
  const t = applyDelta(s, { flags: { b: true } });
  assert.deepEqual(t.world.flags, { a: true, b: true });
});

test('an ended session ignores further deltas', () => {
  const s = { ...playState(), ended: { reason: 'died' } };
  assert.deepEqual(applyDelta(s, { trust: { smith: 3 } }), s);
});

/* -------------------------------------------------------------------------- */
/* The fold                                                                    */
/* -------------------------------------------------------------------------- */

test('the same log always yields the same state', () => {
  const s = playState();
  const log = [
    record({ trust: { smith: 1 } }),
    record({ moveTo: 'market' }),
    record({ learnFacts: ['the forge runs at night'] }),
  ];
  assert.deepEqual(foldPlay(s, log), foldPlay(s, log));
});

test('replaying a prefix then continuing equals replaying the whole log', () => {
  const s = playState();
  const log = [record({ trust: { smith: 2 } }), record({ moveTo: 'market' }), record({ flags: { asked: true } })];
  const whole = foldPlay(s, log);
  const resumed = foldPlay(foldPlay(s, log.slice(0, 2)), log.slice(2));
  assert.deepEqual(resumed, whole);
});

/* -------------------------------------------------------------------------- */
/* Drift lives in the fold                                                     */
/* -------------------------------------------------------------------------- */

test('being spoken to badly, turn after turn, hardens someone', () => {
  const rude = Array.from({ length: 8 }, () => spokenTo('smith', 'กูไม่เชื่อมึง'));
  const after = foldPlay(playState(), rude);
  assert.ok(after.world.people['smith'].temperament.feeling < 0, 'she should have cooled');
});

test('a single rude turn changes nothing about who they are', () => {
  const after = foldPlay(playState(), [spokenTo('smith', 'กูไม่เชื่อมึง')]);
  assert.equal(after.world.people['smith'].temperament.feeling, 0);
  assert.ok(after.world.people['smith'].needs.company < 10, 'though it did land');
});

test('drift is part of the fold, so replaying a session preserves it', () => {
  // If drift lived only in playTurn, resuming from the database would silently
  // undo every personality change that had ever happened.
  const log = [
    ...Array.from({ length: 8 }, () => spokenTo('smith', 'กูไม่เชื่อมึง')),
    spokenTo('warden', 'ผมขอโทษครับ', { trust: { warden: 1 } }),
  ];
  const once = foldPlay(playState(), log);
  const twice = foldPlay(playState(), log);
  assert.deepEqual(once.world.people, twice.world.people);

  const resumed = foldPlay(foldPlay(playState(), log.slice(0, 5)), log.slice(5));
  assert.deepEqual(resumed.world.people, once.world.people, 'a resumed session must not lose drift');
});

test('the player character wears down too', () => {
  const climbing = Array.from({ length: 5 }, () => record({ timeSpent: 3 }));
  const after = foldPlay(playState(), climbing);
  assert.ok(after.sheet.needs.rest < 10, 'travel should tire the climber');
});

test('nobody drifts once the session has ended', () => {
  const ended = { ...playState(), ended: { reason: 'died' } };
  const after = foldPlay(ended, [spokenTo('smith', 'กูไม่เชื่อมึง')]);
  assert.deepEqual(after.world.people['smith'].needs, playState().world.people['smith'].needs);
});

/* -------------------------------------------------------------------------- */
/* AMENDMENTS — a law changing is an event, or replay diverges                  */
/* -------------------------------------------------------------------------- */

test('a law amended during a turn binds afterwards, and the fold reaches the same law', () => {
  // Step 6's requirement: rule changes must be LOGGED events. The delta is what
  // the log stores, so an amendment carried there replays for free — the same
  // reasoning that made a climb an event rather than something recomputed.
  const base = playState();
  assert.equal(forbids(base.world, 'player', 'crossFloors'), null, 'nothing binds the player at the start');

  const sealing = record({ amendLaw: { constraint: 'crossFloors', binds: 'all' } });
  const after = applyDelta(base, sealing.delta);
  assert.ok(forbids(after.world, 'player', 'crossFloors'), 'the tower closed the stairs to everyone');

  const replayed = foldPlay(base, [sealing]);
  assert.ok(forbids(replayed.world, 'player', 'crossFloors'), 'and a reload finds the same world');

  const opening = record({ amendLaw: { constraint: 'crossFloors', binds: null } });
  assert.equal(forbids(foldPlay(base, [sealing, opening]).world, 'player', 'crossFloors'), null);
});

test('a law the engine does not check cannot be legislated by a model', () => {
  // The same boundary as `deed` and `useItem`: the model NAMES from a closed
  // list and the engine decides what it means. A constraint outside the
  // vocabulary is a rule nothing enforces, so it never reaches the world.
  const s = playState();
  const junk = validateDelta(s, { amendLaw: { constraint: 'npcsCannotLie' as never, binds: 'all' } });
  assert.equal(junk.delta.amendLaw, undefined);
  assert.match(junk.rejected.join(' '), /npcsCannotLie/);

  const wrongBinds = validateDelta(s, { amendLaw: { constraint: 'crossFloors', binds: 'everyone' as never } });
  assert.equal(wrongBinds.delta.amendLaw, undefined);
});
