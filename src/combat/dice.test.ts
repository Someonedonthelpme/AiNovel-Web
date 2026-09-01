import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../engine/roll.ts';
import { combineAdvantage, d20, rollDamage } from './dice.ts';

const always = (v: number) => () => v;
const LOW = always(0);        // every die rolls its minimum
const HIGH = always(0.999);   // every die rolls its maximum

test('a plain d20 rolls one die', () => {
  const r = d20(LOW, 3);
  assert.equal(r.dice.length, 1);
  assert.equal(r.natural, 1);
  assert.equal(r.total, 4);
});

test('advantage keeps the higher die, disadvantage the lower', () => {
  const seq = [0.05, 0.9];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const adv = d20(rng, 0, 'advantage');
  assert.equal(adv.dice.length, 2);
  assert.equal(adv.natural, Math.max(...adv.dice));

  i = 0;
  const dis = d20(rng, 0, 'disadvantage');
  assert.equal(dis.natural, Math.min(...dis.dice));
});

test('advantage and disadvantage cancel rather than stack', () => {
  assert.equal(combineAdvantage(true, true), 'none');
  assert.equal(combineAdvantage(true, false), 'advantage');
  assert.equal(combineAdvantage(false, true), 'disadvantage');
  assert.equal(combineAdvantage(false, false), 'none');
});

test('d20 stays within 1..20 over many rolls', () => {
  const rng = mulberry32(11);
  for (let i = 0; i < 5000; i++) {
    for (const d of d20(rng, 0, 'advantage').dice) {
      assert.ok(d >= 1 && d <= 20, `out of range: ${d}`);
    }
  }
});

const abilities = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const d6str = { count: 1, sides: 6, bonusAbility: 'str' as const, type: 'slashing' };

test('a critical hit doubles the dice but NOT the ability modifier', () => {
  const normal = rollDamage(HIGH, d6str, abilities, false);
  assert.deepEqual(normal.dice, [6]);
  assert.equal(normal.total, 9, '6 + 3');

  const crit = rollDamage(HIGH, d6str, abilities, true);
  assert.deepEqual(crit.dice, [6, 6]);
  assert.equal(crit.total, 15, '6 + 6 + 3, not 18');
});

test('damage never heals the target', () => {
  const weak = { count: 1, sides: 4, bonusAbility: 'str' as const, type: 'bludgeoning' };
  const frail = { ...abilities, str: 1 };
  assert.equal(rollDamage(LOW, weak, frail, false).total, 0);
});

test('a missing ability score is treated as 10 rather than NaN', () => {
  const out = rollDamage(HIGH, d6str, { dex: 10 } as never, false);
  assert.equal(out.total, 6);
});
