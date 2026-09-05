import test from 'node:test';
import assert from 'node:assert/strict';
import { believes, firsthand, retell } from '../character/belief.ts';
import type { Belief, Claim } from '../character/belief.ts';
import { AMBIENT_FLOOR, carry, inherited, knownAt, seed } from './ambient.ts';
import type { Ambient } from './ambient.ts';
import { claimOf } from './deed.ts';
import { applyTurn } from '../play/delta.ts';
import { playState } from '../play/fixtures.ts';
import { toWriterView } from '../llm/redact.ts';
import { STANDARD, withOverrides } from '../rules/ruleset.ts';
import type { TurnRecord } from '../play/state.ts';

const claim: Claim = { kind: 'deed', who: 'pc', what: 'insulted:smith' };

/** A street of four: square — market — lane — gate. */
const street = (over: Record<string, string[]> = {}) => [
  { id: 'square', connections: ['market'], people: over.square ?? ['a'] },
  { id: 'market', connections: ['square', 'lane'], people: over.market ?? ['b'] },
  { id: 'lane', connections: ['market', 'gate'], people: over.lane ?? ['c'] },
  { id: 'gate', connections: ['lane'], people: over.gate ?? ['d'] },
];

const air0 = (): Ambient => seed({}, 'square', firsthand(claim));
const heardAt = (ambient: Ambient, place: string) => knownAt(ambient, place)[0]?.confidence ?? 0;

/* -------------------------------------------------------------------------- */
/* A place knows things                                                        */
/* -------------------------------------------------------------------------- */

test('a place holds what is going around, with nobody modelled to hold it', () => {
  /*
   * The scaling correction. A market has no modelled people until somebody is
   * picked out of it, so giving every face a turn just so news could travel
   * would mean creating more NPCs than anyone can afford. Model the medium.
   */
  assert.equal(knownAt(air0(), 'square').length, 1);
  assert.deepEqual(knownAt(air0(), 'gate'), [], 'and a place that has not heard holds nothing');
});

test('seeding the same thing twice cannot inflate it', () => {
  const twice = seed(air0(), 'square', retell(firsthand(claim), 'someone'));
  assert.equal(heardAt(twice, 'square'), 1, 'a weaker account never talks a place down');
});

/* -------------------------------------------------------------------------- */
/* It travels along the MAP                                                    */
/* -------------------------------------------------------------------------- */

test('news creeps outward, so GEOGRAPHY decides what has got around', () => {
  // The square hears it first, the market next, the gate at the edge of town
  // last — which is what makes asking in the right place worth something.
  const near = carry(air0(), street(), 1);
  assert.deepEqual(Object.keys(near).sort(), ['market', 'square']);

  const far = carry(air0(), street(), 9);
  assert.deepEqual(Object.keys(far).sort(), ['gate', 'lane', 'market', 'square']);
});

test('it arrives weaker the further it goes', () => {
  const out = carry(air0(), street(), 9);
  assert.ok(heardAt(out, 'market') < heardAt(out, 'square'));
  assert.ok(heardAt(out, 'gate') < heardAt(out, 'market'), 'the edge of town has only half a story');
});

test('a place nobody walks through CARRIES NOTHING ONWARD', () => {
  /*
   * News travels with people. An emptied quarter is a cut road, and it makes
   * the emptiness felt rather than announced — which is exactly what the
   * transfer-rule answer wanted: no deliverer, no delivery.
   */
  const cut = carry(air0(), street({ market: [] }), 9);
  assert.ok(knownAt(cut, 'market').length > 0, 'it still reaches the empty place');
  assert.deepEqual(knownAt(cut, 'gate'), [], 'but stops dead there');
});

test('it converges rather than saturating', () => {
  // Once every place holds the best account it can reach, `adopt` refuses
  // everything weaker and this stops changing — so a long run does not end
  // with the whole floor equally certain of everything.
  const settled = carry(air0(), street(), 20);
  assert.deepEqual(carry(settled, street(), 20), settled);
});

test('nothing faint enough to be mere talk is passed on at all', () => {
  const faint = seed({}, 'square', { ...firsthand(claim), confidence: AMBIENT_FLOOR - 0.01 });
  assert.deepEqual(Object.keys(carry(faint, street(), 5)), ['square']);
});

test("GOSSIP IS NOT MEMORY: the air clears, and a person's own memory does not", () => {
  /*
   * Without this the field converges and never moves again — a rude word known
   * by the whole town at four-fifths certainty for the rest of the game, and
   * every NPC dragging every deed the player ever did into every prompt.
   */
  let air = carry(air0(), street(), 9);
  const started = heardAt(air, 'market');
  for (let turn = 0; turn < 5; turn++) air = carry(air, street(), 1, 0.2);
  assert.ok(heardAt(air, 'market') < started, 'talk thins out');

  // Far enough out and it stops being worth repeating at all.
  for (let turn = 0; turn < 40; turn++) air = carry(air, street(), 1, 0.2);
  assert.deepEqual(air, {}, 'and eventually nobody is saying it');
});

test('a world that never forgets is the same code with the dial at nought', () => {
  const kept = carry(carry(air0(), street(), 9), street(), 1, 0);
  assert.equal(heardAt(kept, 'square'), 1);
});

test('carrying is deterministic, because a replay has to hear the same things', () => {
  assert.deepEqual(carry(air0(), street(), 5), carry(air0(), street(), 5));
});

/* -------------------------------------------------------------------------- */
/* The two layers meet                                                         */
/* -------------------------------------------------------------------------- */

test('somebody who saw nothing still knows what everyone around them knows', () => {
  // The join, and the reason the ambient field exists at all: walk into the
  // market having done something in the square, and the shopkeeper has heard.
  const held = inherited(undefined, carry(air0(), street(), 3), 'market');
  assert.equal(believes(held, claim), true);
});

test('WHAT THEY SAW OUTRANKS WHAT IS IN THE AIR', () => {
  /*
   * A person's own belief always wins. Somebody who watched it happen must not
   * be talked down to hearsay by standing in a busy street, and somebody told
   * to their face outranks what is merely going around.
   */
  const own: Belief[] = [firsthand(claim)];
  const rumour = carry(air0(), street(), 3);
  assert.equal(inherited(own, rumour, 'gate')[0].confidence, 1);
});

test('a place holding something FALSE passes that on too', () => {
  // A place can be wrong, which is why it holds beliefs rather than facts.
  const wrong = seed({}, 'square', { ...firsthand(claim), holds: false });
  assert.equal(inherited(undefined, wrong, 'square')[0].holds, false);
});

/* -------------------------------------------------------------------------- */
/* The loop, end to end                                                        */
/* -------------------------------------------------------------------------- */

const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  kind: 'turn', input: '', mode: 'conversation', classification: 'NEUTRAL',
  addressed: 'smith', roll: null, delta: {}, rejected: [], prose: '', ...over,
});

test('a deed puts itself in the air where it happened', () => {
  const after = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  assert.equal(believes(knownAt(after.world.ambient, 'town'), claimOf({ kind: 'insulted', doer: 'pc', toward: 'smith', at: 'town' })), true);
});

test('and it reaches the next street over on its own', () => {
  // `town` connects to `market` in the fixture, so one turn of traffic is
  // enough for the market to have heard.
  const after = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  assert.ok(knownAt(after.world.ambient, 'market').length > 0, 'news left the room');
});

test('a stranger elsewhere is written knowing it, without anybody telling them', () => {
  const base = applyTurn(playState(), turn({ input: 'มึงเอาอะไรวะ' })).state;
  // The smith moves to the market, having been there for none of what follows.
  const elsewhere = { ...base, world: { ...base.world, currentPlace: 'market' } };

  const view = toWriterView(elsewhere, {
    brief: { intent: '', mustInclude: [], mustNotMention: [], tone: '', length: 'short' },
    speaking: 'smith',
  });
  assert.ok(view.peoplePresent.find((p) => p.id === 'smith')?.believes.length, 'the market has heard');
});

test('nothing leaves the room in a world whose rules say so', () => {
  const base = playState();
  const quiet = {
    ...base,
    world: { ...base.world, rules: withOverrides(STANDARD, { knowledge: { ambientHops: 0 } }) },
  };
  const after = applyTurn(quiet, turn({ input: 'มึงเอาอะไรวะ' })).state;

  assert.ok(knownAt(after.world.ambient, 'town').length > 0, 'it happened here');
  assert.deepEqual(knownAt(after.world.ambient, 'market'), [], 'and got no further');
});

test('the air is FOLDED, so a replayed session hears the same things', () => {
  const base = playState();
  const record = turn({ input: 'มึงเอาอะไรวะ' });
  assert.deepEqual(applyTurn(base, record).state.world.ambient, applyTurn(base, record).state.world.ambient);
});
