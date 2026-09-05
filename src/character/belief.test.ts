import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adopt, beliefAbout, believes, claimKey, confront, firsthand, hasOpinion,
  HOP_COST, INVERTS_AT, retell, SOURCE_LOST_AT,
} from './belief.ts';
import type { Belief, Claim } from './belief.ts';

const CANNOT_LEAVE: Claim = { kind: 'rule', rule: 'npc_cannot_cross_floors' };
const A_DEED: Claim = { kind: 'deed', who: 'kell', what: 'took the ledger' };

/** Pass a belief along a chain of tellers, as a rumour actually travels. */
function alongChain(start: Belief, tellers: string[]): Belief {
  return tellers.reduce((held, teller) => retell(held, teller), start);
}

/* -------------------------------------------------------------------------- */
/* Claims                                                                      */
/* -------------------------------------------------------------------------- */

test('a bond reads the same from either end', () => {
  // Otherwise two people would hold "the same" claim as two different ones and
  // could never contradict each other about it.
  const one: Claim = { kind: 'bond', a: 'kell', b: 'mara', role: 'lover' };
  const other: Claim = { kind: 'bond', a: 'mara', b: 'kell', role: 'lover' };
  assert.equal(claimKey(one), claimKey(other));
});

test('different kinds of claim never collide', () => {
  const keys = [
    claimKey({ kind: 'lore', id: 'x' }),
    claimKey({ kind: 'rule', rule: 'x' }),
    claimKey({ kind: 'deed', who: 'x', what: 'y' }),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

/* -------------------------------------------------------------------------- */
/* Holding, and not holding                                                    */
/* -------------------------------------------------------------------------- */

test('an absent opinion and a mistaken one are different things', () => {
  // The whole reason this replaced a list of known ids.
  const denies = [firsthand(CANNOT_LEAVE, false)];
  assert.equal(believes(denies, CANNOT_LEAVE), false, 'they do not hold it');
  assert.equal(hasOpinion(denies, CANNOT_LEAVE), true, 'but they have a view on it');
  assert.equal(hasOpinion([], CANNOT_LEAVE), false, 'unlike somebody who never heard');
});

test('a more confident account displaces a weaker one', () => {
  const weak = { ...firsthand(A_DEED), confidence: 0.3 };
  const strong = firsthand(A_DEED);
  assert.equal(beliefAbout(adopt([weak], strong), A_DEED)?.confidence, 1);
});

test('what you saw yourself is not overturned by hearsay', () => {
  // This is what stops a fifth-hand rumour rewriting an eyewitness.
  const seen = firsthand(A_DEED);
  const gossip = { ...firsthand(A_DEED, false), confidence: 0.4, from: 'someone' };
  const after = adopt([seen], gossip);
  assert.equal(believes(after, A_DEED), true);
});

test('adopting never leaves two opinions about one claim', () => {
  const after = adopt(adopt([], firsthand(A_DEED)), { ...firsthand(A_DEED, false), confidence: 1 });
  assert.equal(after.filter((b) => claimKey(b.claim) === claimKey(A_DEED)).length, 1);
});

/* -------------------------------------------------------------------------- */
/* Travelling                                                                  */
/* -------------------------------------------------------------------------- */

test('every retelling costs certainty', () => {
  const first = firsthand(A_DEED);
  const second = retell(first, 'kell');
  assert.equal(second.confidence, first.confidence - HOP_COST);
  assert.equal(second.drift, 1);
});

test('certainty falls but never reaches nothing', () => {
  const far = alongChain(firsthand(A_DEED), Array.from({ length: 30 }, (_, i) => `p${i}`));
  assert.ok(far.confidence > 0, 'people still repeat things they are unsure of');
});

test('far enough along, nobody remembers who said it', () => {
  const near = alongChain(firsthand(A_DEED), ['a']);
  const far = alongChain(firsthand(A_DEED), Array.from({ length: SOURCE_LOST_AT }, (_, i) => `p${i}`));
  assert.equal(near.from, 'a');
  assert.equal(far.from, null, 'everyone knows, nobody knows who said it');
});

test('a story can come back meaning the opposite — but only far along', () => {
  const near = alongChain(firsthand(A_DEED), ['a', 'b']);
  assert.equal(near.holds, true, 'two hands is not enough to invert it');

  // Inversion is chance-based past the threshold, so look across many chains
  // rather than asserting one flips.
  const flipped = Array.from({ length: 40 }, (_, seed) =>
    alongChain(firsthand(A_DEED), Array.from({ length: INVERTS_AT + 3 }, (_, i) => `p${seed}_${i}`)));
  assert.ok(flipped.some((b) => !b.holds), 'somewhere down the line it turns over');
  assert.ok(flipped.some((b) => b.holds), 'and it does not flip every time, which would be noise');
});

test('distortion is deterministic — the same chain gives the same story', () => {
  const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(alongChain(firsthand(A_DEED), chain), alongChain(firsthand(A_DEED), chain));
});

/* -------------------------------------------------------------------------- */
/* Meeting reality — the correction arc                                        */
/* -------------------------------------------------------------------------- */

test('the shopkeeper: a true belief, a lie, and finding out', () => {
  // She believes she cannot leave. That is true, and she holds it firsthand.
  let held = [firsthand(CANNOT_LEAVE, true)];
  assert.equal(believes(held, CANNOT_LEAVE), true);

  // Somebody tells her people like her CAN leave. She takes it on.
  held = adopt(held.map((b) => ({ ...b, confidence: 0.4 })), {
    claim: CANNOT_LEAVE, holds: false, confidence: 0.8, from: 'silas', drift: 1,
  });
  assert.equal(believes(held, CANNOT_LEAVE), false, 'she now thinks she can go');

  // She walks to the stair. The tower says no.
  const met = confront(held, CANNOT_LEAVE, true);
  assert.equal(met.corrected, true);
  assert.equal(met.misledBy, 'silas', 'and she knows exactly who told her');
  assert.equal(believes(met.beliefs, CANNOT_LEAVE), true);
});

test('being right is not a correction, and blames nobody', () => {
  const held = [firsthand(CANNOT_LEAVE, true)];
  const met = confront(held, CANNOT_LEAVE, true);
  assert.equal(met.corrected, false);
  assert.equal(met.misledBy, null);
});

test('finding out something you had no view on is learning, not correction', () => {
  const met = confront([], CANNOT_LEAVE, true);
  assert.equal(met.corrected, false);
  assert.equal(met.misledBy, null);
  assert.equal(believes(met.beliefs, CANNOT_LEAVE), true);
});

test('being wrong on your own blames nobody', () => {
  // You can be mistaken without having been lied to.
  const met = confront([firsthand(CANNOT_LEAVE, false)], CANNOT_LEAVE, true);
  assert.equal(met.corrected, true);
  assert.equal(met.misledBy, null, 'no source, no blame');
});

test('what reality settled is held firsthand afterwards', () => {
  const gossip = { claim: A_DEED, holds: false, confidence: 0.9, from: 'kell', drift: 2 };
  const met = confront([gossip], A_DEED, true);
  const now = beliefAbout(met.beliefs, A_DEED);
  assert.equal(now?.confidence, 1);
  assert.equal(now?.from, null);
  assert.equal(now?.drift, 0, 'you saw it — it did not reach you through anybody');
});

test('confronting is pure', () => {
  const before = [firsthand(CANNOT_LEAVE, false)];
  confront(before, CANNOT_LEAVE, true);
  assert.equal(believes(before, CANNOT_LEAVE), false, 'nothing was mutated');
});
