import test from 'node:test';
import assert from 'node:assert/strict';
import {
  costs, flat, instant, magnitudeOf, purposes, radiusOf, reachesOut, self, single,
  standingBonus, usableInCombat,
} from './effect.ts';
import type { Effect } from './effect.ts';

const hurt = (amount: number): Effect =>
  ({ role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape: single, duration: instant, formula: flat(amount) });

const payMana = (amount: number): Effect =>
  ({ role: 'cost', sign: 'minus', channel: 'mana', who: 'own', shape: self, duration: instant, formula: flat(amount) });

/* -------------------------------------------------------------------------- */
/* Every old payload is expressible                                            */
/* -------------------------------------------------------------------------- */

/*
 * The proof that has to come before any conversion: the eight-arm union was
 * not merely replaceable, it was hiding two compound cases. If a payload
 * cannot be written in components, the model is wrong and nothing should be
 * built on it.
 */

test('strike is one effect', () => {
  const strike = [hurt(6)];
  assert.equal(purposes(strike).length, 1);
  assert.equal(magnitudeOf(strike[0]), 6);
});

test('burst is a strike with a radius', () => {
  const burst: Effect[] = [{ ...hurt(5), shape: { kind: 'burst', radius: 2 } }];
  assert.equal(radiusOf(burst), 2);
  assert.equal(radiusOf([hurt(5)]), 0, 'and a single-target thing has none');
});

test('mend is the same shape pointed at yourself', () => {
  const mend: Effect[] = [{ ...hurt(4), sign: 'plus', who: 'own', shape: self }];
  assert.equal(reachesOut(mend), false, 'it needs nobody');
});

test('hinder and rally are ONE shape pointed differently', () => {
  // The convention that buys this: sign is always from the recipient's side,
  // so `minus` on a condition means it lands and `plus` means it is cleared.
  const hinder: Effect = {
    role: 'purpose', sign: 'minus', channel: 'condition', condition: 'prone',
    who: 'foe', shape: single, duration: { kind: 'rounds', rounds: 2 }, formula: flat(1),
  };
  const rally: Effect = { ...hinder, sign: 'plus', who: 'own', shape: self };

  assert.equal(hinder.channel, rally.channel);
  assert.notEqual(hinder.sign, rally.sign);
});

test('DRAIN was always two effects', () => {
  // The case that justifies a list. It is "hurt them" and "heal me", which the
  // old union could only express by fusing them into one arm.
  const drain: Effect[] = [
    hurt(6),
    { role: 'purpose', sign: 'plus', channel: 'hp', who: 'own', shape: self, duration: instant, formula: flat(3) },
  ];
  assert.equal(purposes(drain).length, 2);
});

test('HEX was always two effects as well', () => {
  const hex: Effect[] = [
    hurt(4),
    {
      role: 'purpose', sign: 'minus', channel: 'condition', condition: 'poisoned',
      who: 'foe', shape: single, duration: { kind: 'rounds', rounds: 3 }, formula: flat(1),
    },
  ];
  assert.equal(purposes(hex).length, 2);
  assert.equal(reachesOut(hex), true);
});

test('edge is a sustained plus on a score, aimed at yourself', () => {
  const edge: Effect[] = [{
    role: 'purpose', sign: 'plus', channel: 'stat', stat: 'wis',
    who: 'own', shape: self, duration: { kind: 'sustained' }, formula: flat(2),
  }];
  assert.equal(standingBonus(edge, 'wis'), 2);
  assert.equal(standingBonus(edge, 'str'), 0, 'and only on the score it names');
  assert.equal(usableInCombat(edge), false, 'a thing you hold is not a thing you spend a turn on');
});

/* -------------------------------------------------------------------------- */
/* What the list buys                                                          */
/* -------------------------------------------------------------------------- */

test('a cost is just another effect, so it need not be a pool', () => {
  // Blood magic is not a special case: it is a cost whose channel is hp.
  const blood: Effect[] = [hurt(9), { ...payMana(0), channel: 'hp', formula: flat(4) }];
  assert.equal(costs(blood).length, 1);
  assert.equal(costs(blood)[0].channel, 'hp');
});

test('a reckless move can cost you a condition', () => {
  const reckless: Effect[] = [hurt(12), {
    role: 'cost', sign: 'minus', channel: 'condition', condition: 'prone',
    who: 'own', shape: self, duration: { kind: 'rounds', rounds: 1 }, formula: flat(1),
  }];
  assert.equal(costs(reckless)[0].channel, 'condition');
});

test('only PURPOSES decide targeting — what it costs you is your business', () => {
  const paid: Effect[] = [{ ...hurt(4), who: 'own', shape: self }, payMana(3)];
  assert.equal(reachesOut(paid), false, 'paying mana does not make it need a target');
});

/* -------------------------------------------------------------------------- */
/* Formulas                                                                    */
/* -------------------------------------------------------------------------- */

test('a magnitude can scale off who is using it', () => {
  // The join to the persona work: a reckless skill genuinely hits harder for
  // somebody bold, rather than being described as though it did.
  const bold: Effect = { ...hurt(4), formula: { flat: 4, scale: { of: 'nerve', per: 1 } } };
  assert.equal(magnitudeOf(bold, { nerve: 3 }), 7);
  assert.equal(magnitudeOf(bold, { nerve: -2 }), 2);
});

test('a flat magnitude ignores whoever holds it', () => {
  assert.equal(magnitudeOf(hurt(6), { nerve: 3 }), 6);
});

test('an unknown scale source contributes nothing rather than NaN', () => {
  const odd: Effect = { ...hurt(4), formula: { flat: 4, scale: { of: 'not_a_thing', per: 2 } } };
  assert.equal(magnitudeOf(odd, {}), 4);
});
