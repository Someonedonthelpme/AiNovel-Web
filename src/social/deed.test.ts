import test from 'node:test';
import assert from 'node:assert/strict';
import { believes } from '../character/belief.ts';
import { axisOf, nudge, PLAYER } from './edge.ts';
import type { Edges } from './edge.ts';
import {
  claimOf, DEEDS, guiltFor, markOf, spreadOf, witnessDeed, witnessesOf,
} from './deed.ts';
import type { Deed } from './deed.ts';
import { applyTurn } from '../play/delta.ts';
import { playState } from '../play/fixtures.ts';
import { compressExcept } from '../world/lod.ts';
import { standingLine } from '../world/floorgen.ts';
import { withOverrides, STANDARD } from '../rules/ruleset.ts';
import type { TurnRecord } from '../play/state.ts';

const deed = (over: Partial<Deed> = {}): Deed =>
  ({ kind: 'insulted', doer: PLAYER, victim: 'smith', at: 'town', ...over });

/** A chain of acquaintance: a knows b knows c knows d. */
function chain(): Edges {
  let edges: Edges = {};
  for (const [x, y] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) {
    edges = nudge(edges, x, y, 'familiarity', 1);
    edges = nudge(edges, y, x, 'familiarity', 1);
  }
  return edges;
}

/* -------------------------------------------------------------------------- */
/* Who saw it                                                                  */
/* -------------------------------------------------------------------------- */

test('the people standing there saw it, and the doer is not a witness to themselves', () => {
  assert.deepEqual(witnessesOf(['smith', 'warden', PLAYER], deed()), ['smith', 'warden']);
});

test('what a witness holds is FIRSTHAND, so nothing second-hand talks them out of it', () => {
  const out = witnessDeed({}, deed(), ['smith'], 0);
  assert.equal(out.knowers.get('smith')?.confidence, 1);
  assert.equal(out.knowers.get('smith')?.from, null, 'you do not have a source for your own eyes');
});

test('a deed nobody saw still happened, and still costs nothing socially', () => {
  const out = witnessDeed({}, deed(), [], 2);
  assert.equal(out.knowers.size, 0);
  assert.equal(out.standing, 0, 'notoriety needs somebody to notice');
});

/* -------------------------------------------------------------------------- */
/* How far it got                                                              */
/* -------------------------------------------------------------------------- */

test('IT SPREADS ALONG THE SOCIAL GRAPH, not along the map', () => {
  // Who hears about it follows who knows whom, so it follows the story rather
  // than the geography.
  const held = spreadOf(chain(), deed({ doer: 'x', victim: 'y' }), ['a'], 3);
  assert.deepEqual([...held.keys()].sort(), ['a', 'b', 'c', 'd']);
});

test('it is bounded by DEGREES OF SEPARATION, not by a headcount', () => {
  // "Seven person theory": the chain runs out rather than a quota filling up,
  // so nobody has to be evicted to make room.
  const at = (depth: number) => [...spreadOf(chain(), deed({ doer: 'x' }), ['a'], depth).keys()].sort();
  assert.deepEqual(at(0), ['a'], 'nothing gets around at all');
  assert.deepEqual(at(1), ['a', 'b']);
  assert.deepEqual(at(2), ['a', 'b', 'c']);
  assert.deepEqual(at(9), ['a', 'b', 'c', 'd'], 'and it stops when it runs out of people');
});

test('it loses certainty every time it is passed on', () => {
  const held = spreadOf(chain(), deed({ doer: 'x' }), ['a'], 3);
  const sure = held.get('a')!.confidence;
  assert.ok(held.get('b')!.confidence < sure);
  assert.ok(held.get('c')!.confidence < held.get('b')!.confidence);
});

test('the doer never hears it from anybody, because they were there', () => {
  let edges = nudge(chain(), 'b', 'x', 'familiarity', 1);
  edges = nudge(edges, 'x', 'b', 'familiarity', 1);
  assert.equal(spreadOf(edges, deed({ doer: 'x' }), ['a'], 4).has('x'), false);
});

test('spreading is deterministic, because a replay has to reach the same people', () => {
  const once = spreadOf(chain(), deed({ doer: 'x' }), ['a'], 3);
  const twice = spreadOf(chain(), deed({ doer: 'x' }), ['a'], 3);
  assert.deepEqual([...once.entries()], [...twice.entries()]);
});

/* -------------------------------------------------------------------------- */
/* What it costs                                                               */
/* -------------------------------------------------------------------------- */

test('the victim and the onlooker do not feel the same thing about the same act', () => {
  // The whole reason edges are directional. Being threatened is frightening;
  // watching it is chilling in another way entirely.
  const out = witnessDeed({}, deed({ kind: 'threatened' }), ['smith', 'warden'], 0);

  assert.ok(axisOf(out.edges, 'smith', PLAYER, 'resentment') > 0, 'the victim resents it');
  assert.equal(axisOf(out.edges, 'warden', PLAYER, 'resentment'), 0, 'the onlooker does not');
  assert.ok(axisOf(out.edges, 'warden', PLAYER, 'regard') < 0, 'but thinks less of you for it');
});

test('hearsay moves somebody less than what they saw with their own eyes', () => {
  const out = witnessDeed(chain(), deed({ kind: 'killed', doer: 'x', victim: 'y' }), ['a'], 3);
  const saw = Math.abs(axisOf(out.edges, 'a', 'x', 'regard'));
  const heard = Math.abs(axisOf(out.edges, 'c', 'x', 'regard'));
  assert.ok(saw > heard, `seen ${saw} should outweigh third-hand ${heard}`);
});

test('GUILT is proportional to what you spoiled, and nothing if you spoiled nothing', () => {
  /*
   * Harming a stranger costs you nothing you would notice. Harming somebody you
   * thought well of is the thing that sits with you — which makes guilt a
   * consequence of the relationship rather than a flat tax on violence.
   */
  const fond = nudge({}, PLAYER, 'smith', 'regard', 3);
  const hurt = witnessDeed(fond, deed({ kind: 'killed' }), ['warden'], 0);
  assert.ok(axisOf(hurt.edges, PLAYER, 'smith', 'guilt') > 0);

  const stranger = witnessDeed({}, deed({ kind: 'killed' }), ['warden'], 0);
  assert.equal(axisOf(stranger.edges, PLAYER, 'smith', 'guilt'), 0);

  assert.equal(guiltFor(-2, 3), 0, 'and none at all for somebody you disliked');
  assert.equal(guiltFor(1, 3), 1, 'capped by how much you actually cared');
});

test('being spared is worth something, and puts you in somebody\'s debt', () => {
  // The one deed that reads well, and `obligation`\'s writer.
  const out = witnessDeed({}, deed({ kind: 'spared' }), ['smith'], 0);
  assert.ok(axisOf(out.edges, 'smith', PLAYER, 'obligation') > 0);
  assert.ok(out.standing > 0, 'and a place thinks better of you for it');
});

test('every deed in the vocabulary actually costs something', () => {
  // The registry rule again: a deed that resolved to nothing would be emitted,
  // propagated, believed and felt by nobody.
  for (const kind of DEEDS) {
    const mark = markOf(kind);
    const moves = Object.keys(mark.onWitness).length + Object.keys(mark.onVictim).length;
    assert.ok(moves > 0, `"${kind}" is declared and lands on nobody`);
    assert.notEqual(mark.standing, 0, `"${kind}" does not move a place's standing`);
  }
});

/* -------------------------------------------------------------------------- */
/* The loop, end to end                                                        */
/* -------------------------------------------------------------------------- */

const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  kind: 'turn', input: '', mode: 'conversation', classification: 'NEUTRAL',
  addressed: 'smith', roll: null, delta: {}, rejected: [], prose: '', ...over,
});

test('speaking roughly in public is an act, and the room sees it', () => {
  /*
   * The chain running for real: the player says something crude, the warden is
   * standing there, and thinks less of them for it — without ever having been
   * spoken to.
   */
  const after = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  assert.ok(axisOf(after.world.edges, 'warden', PLAYER, 'regard') < 0, 'the onlooker saw it');
  assert.equal(believes(after.world.people['warden'].beliefs ?? [], claimOf(deed())), true);
});

test('a courteous turn is not a deed, so nobody has anything to say about it', () => {
  const after = applyTurn(playState(), turn({ input: 'สวัสดีครับ' })).state;
  assert.equal(axisOf(after.world.edges, 'warden', PLAYER, 'regard'), 0);
  assert.equal(after.world.people['warden'].beliefs, undefined);
});

test('WHAT THEY BELIEVE is what a witness ends up holding, not merely what is true', () => {
  // The belief core stops being a tested island here: a deed is a claim, and a
  // person holds it with a confidence that came from how they heard it.
  const after = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  const held = after.world.people['smith'].beliefs ?? [];
  assert.equal(held.length, 1);
  assert.equal(held[0].confidence, 1, 'it was done to them; they are sure');
});

test('REPUTATION finally has a writer, after a life of defaulting to nought', () => {
  const after = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  assert.ok((after.world.reputation?.['floor-0'] ?? 0) < 0, 'a place remembers');
});

test('nothing gets around in a world whose rules say so', () => {
  // The identity value. The same code runs; the chain is one hop long.
  const base = playState();
  const quiet = {
    ...base,
    world: { ...base.world, rules: withOverrides(STANDARD, { knowledge: { spreadDepth: 0, reputationWeight: 0 } }) },
  };
  const after = applyTurn(quiet, turn({ input: 'มึงเอาอะไรวะ' })).state;
  assert.equal(after.world.reputation?.['floor-0'] ?? 0, 0, 'and no notoriety accrues at all');
});

test('deeds are FOLDED, so a replayed session earns the same reputation', () => {
  const base = playState();
  const record = turn({ input: 'มึงเอาอะไรวะ' });
  assert.deepEqual(applyTurn(base, record).state.world, applyTurn(base, record).state.world);
});

/* -------------------------------------------------------------------------- */
/* And it survives leaving                                                     */
/* -------------------------------------------------------------------------- */

test('standing travels with the summary when a floor compresses', () => {
  /*
   * `Gazetteer.reputation` was generated, defaulted to nought and read by
   * nobody for the whole life of the codebase. It lives on the World so it
   * survives REHYDRATION too — a floor rebuilt by a model would otherwise
   * forget what you did there.
   */
  const base = playState();
  const earned = { ...base.world, reputation: { 'floor-0': -7 } };
  const compressed = compressExcept(earned, [], earned.turn);

  const gaz = compressed.regions['floor-0'];
  assert.equal(gaz.detail, 'gazetteer');
  assert.equal(gaz.detail === 'gazetteer' && gaz.reputation, -7);
  assert.equal(compressed.reputation?.['floor-0'], -7, 'and the durable copy stays put');
});

test('a place that remembers you says so to whoever rebuilds it', () => {
  assert.match(standingLine(-7), /closed doors|worse/i);
  assert.match(standingLine(-3), /not welcome/i);
  assert.match(standingLine(7), /well thought of/i);
});
