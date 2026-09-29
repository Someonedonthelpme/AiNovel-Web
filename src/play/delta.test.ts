import { axisOf, GRUDGE_THRESHOLD, hostileToward, PLAYER, trustToward } from '../social/edge.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, applyTurn, foldPlay, validateDelta } from './delta.ts';
import { FOLK } from '../character/species.ts';
import { activeRegion, clockOf, linkMinutes, stairCost, travelTime } from '../world/travel.ts';
import { MINUTES_PER_TICK, TICKS_PER_DAY } from '../world/calendar.ts';
import { takeRest } from './rest.ts';
import { NEED_MAX } from '../character/persona.ts';
import { playState, emptyDelta, directorOutput } from './fixtures.ts';
import { forbids, STANDARD } from '../rules/ruleset.ts';
import type { PlayState, TurnRecord, WorldDelta } from './state.ts';
import { addBuilding, buildingAt } from '../world/settlement.ts';
import { isFull } from '../world/types.ts';
import type { Building } from '../world/workstation.ts';
import type { Region } from '../world/types.ts';
import { DIRECTOR_SCHEMA, runDirector, toWorldDelta } from '../llm/director.ts';
import { FakeProvider } from '../llm/provider.ts';
import { CRIMINAL_LAWS } from '../world/al.ts';
import type { AlLawId, SuccessionLawId } from '../world/al.ts';

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

/* -------------------------------------------------------------------------- */
/* SPECIES — the kinds a world holds                                           */
/* -------------------------------------------------------------------------- */

test('a climber of a kind that does not eat crosses a floor without getting hungry', () => {
  // The wire, not the multiplier: `applyDrift` learned about kinds in
  // isolation, and this is what proves the fold looks up who the walker
  // actually IS before wearing them down.
  const base = playState();
  const made = { id: 'made', name: 'the made', needs: { food: 0 } };
  const world = { ...base.world, species: [FOLK, made] };

  // Respecified by 7.1e-iv: food drops by the HOUR now, so the march is six hours long.
  const march = (s: typeof base) => foldPlay(s, Array.from({ length: 12 }, () => record({ timeSpent: 3 })));
  const ordinary = march({ ...base, world });
  assert.ok(ordinary.sheet.needs.food < NEED_MAX, 'an ordinary climber marches on their stomach');

  const construct = {
    ...base,
    world,
    sheet: { ...base.sheet, species: 'made' },
  };
  const after = march(construct);

  assert.equal(after.sheet.needs.food, NEED_MAX, 'and this one has no stomach to march on');
  assert.equal(after.sheet.needs.rest, ordinary.sheet.needs.rest, 'while the march tires it the same');
});

/* -------------------------------------------------------------------------- */
/* A WORLD CAN GROW SIDEWAYS                                                   */
/* -------------------------------------------------------------------------- */

test('a way out found in play becomes a way out, and the fold finds the same one', () => {
  // How a world that is not a stack ever comes to exist. The Director says a
  // road leads out of the market; the ENGINE decides where that is — a model
  // that could mint region ids would be authoring the map's shape, which is
  // the line this codebase does not cross.
  const base = playState();
  assert.deepEqual(activeRegion(base.world)?.exits ?? [], [], 'the town starts as a plain stack');

  const found = record({ revealWay: 'market' });
  const after = applyDelta(base, found.delta);
  const exits = activeRegion(after.world)?.exits ?? [];

  assert.equal(exits.length, 1);
  assert.equal(exits[0].via, 'market');
  assert.equal(exits[0].floor, 0, 'a road out of town leads somewhere at the same depth');
  assert.ok(exits[0].to.length > 0, 'and the engine named where');

  const replayed = foldPlay(base, [found]);
  assert.deepEqual(activeRegion(replayed.world)?.exits, exits, 'minted from state, so a reload agrees');
});

test('a way out the model invents somewhere that does not exist is refused', () => {
  const s = playState();
  const nowhere = validateDelta(s, { revealWay: 'the-moon' });
  assert.equal(nowhere.delta.revealWay, undefined);
  assert.match(nowhere.rejected.join(' '), /the-moon/);
});

test("a world's own drift dials reach a real turn, not STANDARD's", () => {
  // Both drift calls in `applyTurn` once fell back to STANDARD, so a world's
  // `driftThreshold` was proven at `applyDrift` and never reached play.
  const base = playState();
  const pressed = { ...base, sheet: { ...base.sheet, pressure: { ...base.sheet.pressure, nerve: 3 } } };
  const touchy = {
    ...pressed,
    world: { ...pressed.world, rules: { ...STANDARD, persona: { ...STANDARD.persona, driftThreshold: 2 } } },
  };

  const calm = applyTurn(pressed, record({ timeSpent: 1 })).state;
  assert.equal(calm.sheet.temperament.nerve, pressed.sheet.temperament.nerve, 'STANDARD: 3 is short of 6');

  const shifted = applyTurn(touchy, record({ timeSpent: 1 })).state;
  assert.equal(shifted.sheet.temperament.nerve, pressed.sheet.temperament.nerve + 1, 'its own dial: 3 crosses 2');
});

test('an ambush costs no standing; drawing first still does', () => {
  // `drewOn` was charged to the player on every fight, so being jumped cost you
  // standing for a fight you did not start.
  const base = playState();
  const here = base.world.currentRegion;

  const ambush = applyTurn(base, record({ startCombat: true, startedBy: 'them' })).state;
  assert.equal(ambush.world.reputation?.[here] ?? 0, 0, 'not your fight, no cost');

  const drawn = applyTurn(base, record({ startCombat: true })).state;
  assert.ok((drawn.world.reputation?.[here] ?? 0) < 0, 'drawing first still costs');
});

/*
 * 6b stage 7.1a: a link costs TIME, and a world clock runs separately from the
 * play-turn count. Each play turn covers the time its action takes.
 */

// Respecified by W1 (DESIGN 6c §2): a link was a flat 1 to 3 ticks, set by the seed.
// Its time is now minutes weighted by kind and biome; the clock pays it in whole ticks.
test('a link costs whole ticks, rounded up from its minutes, the same both ways', () => {
  const w = playState().world;
  const cost = travelTime(w, 'town', 'market');
  assert.equal(cost, travelTime(w, 'market', 'town'));
  assert.equal(cost, Math.ceil(linkMinutes(w, 'town', 'market') / MINUTES_PER_TICK));
});

test('a move covers its link on the clock; the turn count still moves by one', () => {
  const s = playState();
  const after = applyDelta(s, { moveTo: 'market' });
  assert.equal(after.world.turn, s.world.turn + 1, 'fights keep their seeds');
  assert.equal(clockOf(after.world) - clockOf(s.world), travelTime(s.world, 'town', 'market'));
});

test('a turn that goes nowhere still covers time', () => {
  const s = playState();
  assert.equal(clockOf(applyDelta(s, {}).world), clockOf(s.world) + 1);
  assert.equal(clockOf(applyDelta(s, { timeSpent: 3 }).world), clockOf(s.world) + 3);
});

test('a world stored without a clock reads it from its turn count', () => {
  const { clock: _, ...old } = playState().world;
  assert.equal(clockOf(old), old.turn);
});

// Was: "a long crossing wears you down more than a short one", one 10–30 minute
// walk against another. Respecified by 7.1e-iv: needs drain on whole hours, so
// whether a single walk wears you depends on the hour it crosses. The claim is
// kept at the scale it now holds: more hours on the road, more worn.
test('six hours on the road wear you more than one', () => {
  const base = { ...playState(), world: { ...playState().world, clock: 0 } };
  const onTheRoad = (hours: number) =>
    foldPlay(base, Array.from({ length: hours * 2 }, () => record({ timeSpent: 3 }))).sheet.needs.rest;
  assert.ok(onTheRoad(6) < onTheRoad(1), `six hours ${onTheRoad(6)}, one hour ${onTheRoad(1)}`);
});

/*
 * 6b stage 7.1e-i: a tick is TEN MINUTES. Rest takes real hours; a stair
 * between floors takes hours.
 */

test('a tick is ten minutes; a day is 144 ticks', () => {
  assert.equal(MINUTES_PER_TICK, 10);
  assert.equal(TICKS_PER_DAY, 144);
});

test('a stair between floors takes one to three hours', () => {
  const c = stairCost(playState().world, 'floor-0', 'floor-1');
  assert.ok(c >= 6 && c <= 18, `${c}`);
  assert.equal(c, stairCost(playState().world, 'floor-1', 'floor-0'), 'the same both ways');
});

test('a short rest covers an hour on the clock, a long rest eight', () => {
  const s = playState();                                   // in town on floor 0, with rations
  assert.equal(clockOf(takeRest(s, 'short').state.world) - clockOf(s.world), 6);
  assert.equal(clockOf(takeRest(s, 'long').state.world) - clockOf(s.world), 48);
  assert.equal(clockOf(applyDelta(s, { rest: 'long' }).world) - clockOf(s.world), 48, 'and as a turn');
});

/*
 * Working a workstation, the first play verb to reach DESIGN 6c §3h's station
 * system. One economic workstation with a real method, one administrative
 * one with none, both on a building standing in `town`.
 */

const withWorkstation = (state: PlayState): PlayState => {
  const r = state.world.regions['floor-0'];
  if (!isFull(r)) throw new Error('fixture: floor-0 must be full detail');
  const smithy: Building = {
    id: 'smithy-1',
    tier: 1,
    container: { material: 2 },
    workstations: [
      { id: 'anvil', subkind: 'economic', method: { input: [{ category: 'material', count: 2 }], output: [{ category: 'weapon', count: 1 }], time: 1 } },
      { id: 'hall-desk', subkind: 'administrative' },
    ],
  };
  return { ...state, world: { ...state.world, regions: { ...state.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? addBuilding(p, smithy) : p)) } } } };
};

// Respecifies the prior version of this test: it asserted a full batch always
// completes, which only held because efficiency was hardcoded to 1 — the exact bug
// DESIGN 6c §3j-i's wiring fixes. New intent: efficiency is real (raw-stat, §3j-i),
// and at these placeholder numbers a str-13 worker (eff ~=0.389) can't clear the
// anvil's time:1 recipe in one turn.
test("a workstation runs at the worker's real efficiency, not always full", () => {
  const done = applyTurn(withWorkstation(playState()), record({ runWorkstation: { building: 'smithy-1', workstation: 'anvil' } })).state;
  const town = (done.world.regions['floor-0'] as Region).places.find((p) => p.id === 'town')!;
  assert.deepEqual(buildingAt(town, 'smithy-1')?.container, { material: 2 });
});

const withFastWorkstation = (state: PlayState): PlayState => {
  const r = state.world.regions['floor-0'];
  if (!isFull(r)) throw new Error('fixture: floor-0 must be full detail');
  const forge: Building = { id: 'forge-1', tier: 1, container: {}, workstations: [{ id: 'anvil', subkind: 'economic', method: { input: [], output: [{ category: 'weapon', count: 1 }], time: 0.3 } }] };
  return { ...state, world: { ...state.world, regions: { ...state.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? addBuilding(p, forge) : p)) } } } };
};
const withStr = (s: PlayState, str: number): PlayState => ({ ...s, sheet: { ...s.sheet, baseAbilities: { ...s.sheet.baseAbilities, str } } });

test('a weak worker (raw STR 1) clears nothing from a 0.3-hour recipe', () => {
  const done = applyTurn(withStr(withFastWorkstation(playState()), 1), record({ runWorkstation: { building: 'forge-1', workstation: 'anvil' } })).state;
  const town = (done.world.regions['floor-0'] as Region).places.find((p) => p.id === 'town')!;
  assert.deepEqual(buildingAt(town, 'forge-1')?.container, {});
});

test('a strong worker (raw STR 20) clears the recipe the weak one could not', () => {
  const done = applyTurn(withStr(withFastWorkstation(playState()), 20), record({ runWorkstation: { building: 'forge-1', workstation: 'anvil' } })).state;
  const town = (done.world.regions['floor-0'] as Region).places.find((p) => p.id === 'town')!;
  assert.deepEqual(buildingAt(town, 'forge-1')?.container, { weapon: 1 });
});

/*
 * A `service` workstation (DESIGN 6c §3h): no input, no container touched -
 * it raises the worker's own Need instead. Same off-class rule as economic.
 */

const withServiceWorkstation = (state: PlayState): PlayState => {
  const r = state.world.regions['floor-0'];
  if (!isFull(r)) throw new Error('fixture: floor-0 must be full detail');
  const inn: Building = { id: 'inn-1', tier: 1, container: {}, workstations: [{ id: 'hearth', subkind: 'service', serviceMethod: { output: [{ need: 'rest', amount: 3 }], time: 0.3 } }] };
  return { ...state, world: { ...state.world, regions: { ...state.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? addBuilding(p, inn) : p)) } } } };
};

test("a service workstation raises the worker's need instead of touching goods", () => {
  const s = withServiceWorkstation(playState());
  const low = { ...s, sheet: { ...s.sheet, needs: { ...s.sheet.needs, rest: 4 } } };
  const done = applyTurn(low, record({ runWorkstation: { building: 'inn-1', workstation: 'hearth' } })).state;
  assert.ok(done.sheet.needs.rest > 4);
  const town = (done.world.regions['floor-0'] as Region).places.find((p) => p.id === 'town')!;
  assert.deepEqual(buildingAt(town, 'inn-1')?.container, {});
});

test('the engine refuses working a station it should not, and says why', () => {
  const elsewhere = (): PlayState => { const s = withWorkstation(playState()); return { ...s, world: { ...s.world, currentPlace: 'market' } }; };
  const cases: [string, PlayState, { building: string; workstation: string }, RegExp][] = [
    ['no such building', withWorkstation(playState()), { building: 'nope', workstation: 'anvil' }, /building/],
    ['no such workstation', withWorkstation(playState()), { building: 'smithy-1', workstation: 'nope' }, /workstation/],
    ['no method to run', withWorkstation(playState()), { building: 'smithy-1', workstation: 'hall-desk' }, /no method/],
    ['not standing there', elsewhere(), { building: 'smithy-1', workstation: 'anvil' }, /here/],
  ];
  for (const [why, state, req, reason] of cases) {
    const v = validateDelta(state, { runWorkstation: req });
    assert.equal(v.delta.runWorkstation, undefined, why);
    assert.match(v.rejected.join(' '), reason, why);
  }
});

/* The Director's side: naming a workstation via workBuilding/workStation. */

test('toWorldDelta turns workBuilding/workStation into a runWorkstation delta', () => {
  const flat = { ...emptyDelta(), workBuilding: 'smithy-1', workStation: 'anvil' };
  assert.deepEqual(toWorldDelta(flat).runWorkstation, { building: 'smithy-1', workstation: 'anvil' });
});

test('either field empty means no runWorkstation at all', () => {
  assert.equal(toWorldDelta({ ...emptyDelta(), workBuilding: 'smithy-1' }).runWorkstation, undefined);
  assert.equal(toWorldDelta({ ...emptyDelta(), workStation: 'anvil' }).runWorkstation, undefined);
});

test('the Director is told which workstations exist here, and cannot name one it was never shown', async () => {
  const state = withWorkstation(playState());
  const provider = new FakeProvider({ structured: [directorOutput()] });
  await runDirector(provider, state, 'work the forge', 'conversation', []);
  assert.ok(provider.allSentText().includes('smithy-1'));
  assert.ok(provider.allSentText().includes('anvil'));
  assert.ok(!provider.allSentText().includes('hall-desk'), 'a methodless workstation is not offered');
});

test('a service workstation is also offered to the Director, not just economic ones', async () => {
  const state = withServiceWorkstation(playState());
  const provider = new FakeProvider({ structured: [directorOutput()] });
  await runDirector(provider, state, 'rest at the hearth', 'conversation', []);
  assert.ok(provider.allSentText().includes('inn-1'));
  assert.ok(provider.allSentText().includes('hearth'));
});

/*
 * Adopting a territorial law through a hall (DESIGN 6c §3k/§3k-i): the
 * administrative workstation has no runner (§3h) - only the settlement's own
 * holder may operate it, and only when its AL unit actually has scope (a
 * seat, never "bare, local-only").
 */

const withHall = (state: PlayState): PlayState => {
  const s = withWorkstation(state);
  const r = s.world.regions['floor-0'];
  if (!isFull(r)) throw new Error('fixture: floor-0 must be full detail');
  return {
    ...s,
    world: {
      ...s.world,
      regions: {
        ...s.world.regions,
        'floor-0': {
          ...r,
          alUnits: { d1: { id: 'd1', kind: 'district' as const, seat: 'town' } },
          places: r.places.map((p) => (p.id === 'town' ? { ...p, alUnit: 'd1', holder: PLAYER } : p)),
        },
      },
    },
  };
};

test('the player adopts a law through a seat settlement they hold', () => {
  const done = applyTurn(withHall(playState()), record({ adoptLaw: 'theft' })).state;
  const region = done.world.regions['floor-0'] as Region;
  assert.deepEqual(region.alUnits!.d1.laws, ['theft']);
});

test('the engine refuses adopting a law it should not, and says why', () => {
  const notHeld = (): PlayState => {
    const s = withHall(playState());
    const r = s.world.regions['floor-0'] as Region;
    return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: undefined } : p)) } } } };
  };
  const noHallBuilding = (): PlayState => {
    const s = playState();
    const r = s.world.regions['floor-0'] as Region;
    return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: PLAYER } : p)) } } } };
  };
  const bareHall = (): PlayState => {
    const s = withWorkstation(playState());
    const r = s.world.regions['floor-0'] as Region;
    return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: PLAYER } : p)) } } } };
  };
  // Standing elsewhere (e.g. the market) is not a distinct refusal path: the
  // player genuinely does not hold that place either, so it surfaces through
  // the same "you do not hold this settlement" check as `notHeld` below.
  const cases: [string, PlayState, RegExp][] = [
    ['not held by the player', notHeld(), /hold/],
    ['no hall on any building', noHallBuilding(), /hall/],
    ['a hall with no AL scope — bare, local-only', bareHall(), /scope/],
  ];
  for (const [why, state, reason] of cases) {
    const v = validateDelta(state, { adoptLaw: 'theft' });
    assert.equal(v.delta.adoptLaw, undefined, why);
    assert.match(v.rejected.join(' '), reason, why);
  }
});

test('a law the engine does not know is refused, not silently accepted', () => {
  const v = validateDelta(withHall(playState()), { adoptLaw: 'loitering' as AlLawId });
  assert.equal(v.delta.adoptLaw, undefined);
});

test('toWorldDelta turns adoptLaw into a WorldDelta field, "none" means nothing', () => {
  assert.equal(toWorldDelta({ ...emptyDelta(), adoptLaw: 'theft' }).adoptLaw, 'theft');
  assert.equal(toWorldDelta({ ...emptyDelta(), adoptLaw: 'none' }).adoptLaw, undefined);
});

test('the Director is offered adoptLaw only where a real seat hall exists', async () => {
  const state = withHall(playState());
  const provider = new FakeProvider({ structured: [directorOutput()] });
  await runDirector(provider, state, 'declare theft illegal here', 'conversation', []);
  assert.ok(provider.allSentText().includes('theft'));
});

test('adoptLaw is never offered without a real seat hall', async () => {
  const state = withWorkstation(playState()); // a hall stands here, but nobody holds it and it seats no unit
  const provider = new FakeProvider({ structured: [directorOutput()] });
  await runDirector(provider, state, 'look around', 'conversation', []);
  assert.ok(!provider.allSentText().includes('Law here'));
});

/*
 * Setting a settlement's succession law (DESIGN 6c §3k-i): the same hall
 * authority as adoptLaw, but a single CHOICE, replaced rather than
 * unioned - setting it again overwrites instead of accumulating.
 */

test('the player sets a succession law through a seat settlement they hold', () => {
  const done = applyTurn(withHall(playState()), record({ setSuccession: 'stationRank' })).state;
  const region = done.world.regions['floor-0'] as Region;
  assert.equal(region.alUnits!.d1.succession, 'stationRank');
});

test('setting succession again REPLACES the choice, unlike adoptLaw which unions', () => {
  const first = applyTurn(withHall(playState()), record({ setSuccession: 'stationRank' })).state;
  const second = applyTurn(first, record({ setSuccession: 'elective' })).state;
  assert.equal((second.world.regions['floor-0'] as Region).alUnits!.d1.succession, 'elective');
});

test('the engine refuses setting succession without the same hall authority adoptLaw requires', () => {
  const notHeld = (): PlayState => {
    const s = withHall(playState());
    const r = s.world.regions['floor-0'] as Region;
    return { ...s, world: { ...s.world, regions: { ...s.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: undefined } : p)) } } } };
  };
  const v = validateDelta(notHeld(), { setSuccession: 'stationRank' });
  assert.equal(v.delta.setSuccession, undefined);
  assert.match(v.rejected.join(' '), /hold/);
});

test('a succession choice the engine does not know is refused, not silently accepted', () => {
  const v = validateDelta(withHall(playState()), { setSuccession: 'primogeniture' as SuccessionLawId });
  assert.equal(v.delta.setSuccession, undefined);
});

test('toWorldDelta turns setSuccession into a WorldDelta field, "none" means nothing', () => {
  assert.equal(toWorldDelta({ ...emptyDelta(), setSuccession: 'stationRank' }).setSuccession, 'stationRank');
  assert.equal(toWorldDelta({ ...emptyDelta(), setSuccession: 'none' }).setSuccession, undefined);
});

test('the Director is offered setSuccession under the same gate as adoptLaw', async () => {
  const state = withHall(playState());
  const provider = new FakeProvider({ structured: [directorOutput()] });
  await runDirector(provider, state, 'change how the town picks its next holder', 'conversation', []);
  assert.ok(provider.allSentText().includes('stationRank'));
});

/*
 * Arrest and consequence (DESIGN 6c §3k-ii): unlawful assault reaches the AL
 * unit's ruler directly, as a resentment nudge - not through the ordinary
 * witness/spread system. No new deed kind, no belief entry: the existing,
 * unmodified grudge machinery (setOut/hostileToward) is the whole mechanism.
 */

const withAssaultLaw = (state: PlayState): PlayState => {
  const r = state.world.regions['floor-0'] as Region;
  return {
    ...state,
    world: {
      ...state.world,
      regions: {
        ...state.world.regions,
        'floor-0': {
          ...r,
          alUnits: { d1: { id: 'd1', kind: 'district' as const, seat: 'town', laws: ['assault'] as AlLawId[] } },
          places: r.places.map((p) => (p.id === 'town' ? { ...p, alUnit: 'd1' } : p)),
        },
      },
    },
  };
};

test('striking first where assault is unlawful gives the ruler a real grudge', () => {
  const done = applyTurn(withAssaultLaw(playState()), record({ startCombat: true, startedBy: 'player' })).state;
  assert.ok(axisOf(done.world.edges, 'warden', PLAYER, 'resentment') >= GRUDGE_THRESHOLD);
});

test('striking first where assault was never adopted gives no grudge at all', () => {
  const done = applyTurn(playState(), record({ startCombat: true, startedBy: 'player' })).state;
  assert.equal(axisOf(done.world.edges, 'warden', PLAYER, 'resentment'), 0);
});

test('being attacked, not attacking, is never unlawful assault', () => {
  const done = applyTurn(withAssaultLaw(playState()), record({ startCombat: true, startedBy: 'them' })).state;
  assert.equal(axisOf(done.world.edges, 'warden', PLAYER, 'resentment'), 0);
});

test('an unlawful assault crosses the grudge threshold — hostileToward agrees, unmodified', () => {
  const done = applyTurn(withAssaultLaw(playState()), record({ startCombat: true, startedBy: 'player' })).state;
  assert.ok(hostileToward(done.world.edges, 'warden'));
});

/*
 * repealLaw and law visibility (DESIGN 6c §3k): the same hall authority as
 * adoptLaw, the unit's OWN set only, and the Director is told what is in force
 * so a law passed by mistake can be seen and repealed.
 */

const withUnits = (state: PlayState, alUnits: Region['alUnits']): PlayState => {
  const r = state.world.regions['floor-0'] as Region;
  return { ...state, world: { ...state.world, regions: { ...state.world.regions, 'floor-0': { ...r, alUnits } } } };
};
const ownLaws = (laws: AlLawId[]): PlayState =>
  withUnits(withHall(playState()), { d1: { id: 'd1', kind: 'district' as const, seat: 'town', laws } });
const inheritedAssault = (): PlayState =>
  withUnits(withHall(playState()), {
    s: { id: 's', kind: 'state' as const, laws: ['assault'] as AlLawId[] },
    d1: { id: 'd1', kind: 'district' as const, seat: 'town', parent: 's' },
  });
const release = (state: PlayState): PlayState => {
  const r = state.world.regions['floor-0'] as Region;
  return { ...state, world: { ...state.world, regions: { ...state.world.regions, 'floor-0': { ...r, places: r.places.map((p) => (p.id === 'town' ? { ...p, holder: undefined } : p)) } } } };
};

test('the engine accepts repealing an own adopted law and refuses the rest, saying why', () => {
  assert.equal(validateDelta(ownLaws(['assault']), { repealLaw: 'assault' }).delta.repealLaw, 'assault');
  const cases: [string, PlayState, string, RegExp][] = [
    ['never adopted', ownLaws([]), 'assault', /not adopted here/],
    ['only inherited from above', inheritedAssault(), 'assault', /inherited/],
    ['not held by the player', release(ownLaws(['assault'])), 'assault', /hold/],
    ['a law the engine does not know', ownLaws(['assault']), 'loitering', /no such law/],
  ];
  for (const [why, state, law, reason] of cases) {
    const v = validateDelta(state, { repealLaw: law as AlLawId });
    assert.equal(v.delta.repealLaw, undefined, why);
    assert.match(v.rejected.join(' '), reason, why);
  }
});

test('adopt then repeal across two turns leaves the law unbound and enforcement stops', () => {
  const adopted = applyTurn(withHall(playState()), record({ adoptLaw: 'assault' })).state;
  const drawFirst = (s: PlayState) => applyTurn(release(s), record({ startCombat: true, startedBy: 'player' })).state;
  // Control: the law stands, the ruler (no longer the player) resents the first blow.
  assert.ok(axisOf(drawFirst(adopted).world.edges, 'warden', PLAYER, 'resentment') >= GRUDGE_THRESHOLD);
  const repealed = applyTurn(adopted, record({ repealLaw: 'assault' })).state;
  assert.deepEqual((repealed.world.regions['floor-0'] as Region).alUnits!.d1.laws, undefined);
  assert.equal(axisOf(drawFirst(repealed).world.edges, 'warden', PLAYER, 'resentment'), 0);
});

test('the Director is told which laws are in force, and which are its own to repeal', async () => {
  const sentFor = async (state: PlayState) => {
    const provider = new FakeProvider({ structured: [directorOutput()] });
    await runDirector(provider, state, 'look around', 'conversation', []);
    return provider.allSentText();
  };
  const both = await sentFor(withUnits(withHall(playState()), {
    s: { id: 's', kind: 'state' as const, laws: ['assault'] as AlLawId[] },
    d1: { id: 'd1', kind: 'district' as const, seat: 'town', parent: 's', laws: ['theft'] as AlLawId[], succession: 'stationRank' as SuccessionLawId },
  }));
  assert.match(both, /Laws in force here:[^\n]*theft \(own\)/);
  assert.match(both, /Laws in force here:[^\n]*assault \(inherited\)/);
  assert.match(both, /Succession in force here: stationRank/);
  assert.equal(both.match(/the ONLY legal repealLaw ids\): ([^\n]*)/)?.[1], 'theft', 'only the OWN law is offered for repeal');
  const none = await sentFor(ownLaws([]));
  assert.match(none, /Laws in force here: none/);
  assert.ok(!none.includes('the ONLY legal repealLaw ids'), 'nothing to repeal, so it is never offered');
  assert.ok(!(await sentFor(inheritedAssault())).includes('the ONLY legal repealLaw ids'), 'an inherited law is not offered');
});

test('repealLaw is a Director schema field and toWorldDelta reads it, "none" meaning nothing', () => {
  const deltaSchema = (DIRECTOR_SCHEMA as any).properties.delta;
  assert.deepEqual(deltaSchema.properties.repealLaw.enum, ['none', ...CRIMINAL_LAWS]);
  assert.ok(deltaSchema.required.includes('repealLaw'));
  assert.equal(toWorldDelta({ ...emptyDelta(), repealLaw: 'assault' } as never).repealLaw, 'assault');
  assert.equal(toWorldDelta({ ...emptyDelta(), repealLaw: 'none' } as never).repealLaw, undefined);
});
