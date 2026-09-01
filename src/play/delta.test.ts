import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, foldPlay, validateDelta } from './delta.ts';
import { playState } from './fixtures.ts';
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

test('trust changes are relative and clamp to the band', () => {
  const s = playState();
  const up = applyDelta(s, { trust: { smith: 2 } });
  assert.equal(up.world.people['smith'].trust, 2);

  const capped = applyDelta(up, { trust: { smith: 99 } });
  assert.equal(capped.world.people['smith'].trust, 4, 'cannot exceed the top band');

  const floored = applyDelta(s, { trust: { warden: -99 } });
  assert.equal(floored.world.people['warden'].trust, -3);
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
  assert.ok(after.world.people['smith'].personality.warmth < 0, 'she should have cooled');
});

test('a single rude turn changes nothing about who they are', () => {
  const after = foldPlay(playState(), [spokenTo('smith', 'กูไม่เชื่อมึง')]);
  assert.equal(after.world.people['smith'].personality.warmth, 0);
  assert.ok(after.world.people['smith'].mental.stress > 0, 'though it did land');
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
  assert.ok(after.sheet.mental.fatigue > 0, 'travel should tire the climber');
});

test('nobody drifts once the session has ended', () => {
  const ended = { ...playState(), ended: { reason: 'died' } };
  const after = foldPlay(ended, [spokenTo('smith', 'กูไม่เชื่อมึง')]);
  assert.deepEqual(after.world.people['smith'].mental, playState().world.people['smith'].mental);
});
