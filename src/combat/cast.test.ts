import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCast, beginCast, breakCast, finishCast, holdDC, isCasting } from './cast.ts';
import { abilities, combatant, d20Sequence } from './fixtures.ts';
import type { Combatant } from './types.ts';

const caster = (over: Partial<Combatant> = {}): Combatant =>
  combatant('pc', { mana: 10, maxMana: 30, stamina: 10, maxStamina: 30, ...over });

/** A cast eight ticks long that cost ten mana, `done` ticks in. */
const midCast = (done: number, over: Partial<Combatant> = {}) => {
  const started = beginCast(caster(over), 'big', 'orc', 8, 10, 'mana');
  return advanceCast(started, done).who;
};

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

test('a cast is fed by the rounds that follow it', () => {
  const started = beginCast(caster(), 'big', 'orc', 8, 10, 'mana');
  assert.equal(isCasting(started), true);

  const first = advanceCast(started, 5);
  assert.equal(first.ready, false, 'five of eight is not finished');
  assert.equal(first.who.pendingCast?.done, 5);

  const second = advanceCast(first.who, 5);
  assert.equal(second.ready, true, 'ten of eight is');
  assert.equal(second.who.pendingCast?.done, 8, 'and it never overshoots its total');
});

test('a cast nobody feeds goes nowhere', () => {
  const started = beginCast(caster(), 'big', 'orc', 8, 10, 'mana');
  assert.equal(advanceCast(started, 0).ready, false);
  assert.equal(advanceCast(started, -3).who.pendingCast?.done, 0, 'an overrun cannot un-cast it');
});

test('finishing clears it and refunds nothing', () => {
  // It was spent as intended. Only a BREAK gives anything back.
  const done = midCast(8);
  const cleared = finishCast(done);
  assert.equal(isCasting(cleared), false);
  assert.equal(cleared.mana, 10, 'a completed cast returns nothing');
});

/* -------------------------------------------------------------------------- */
/* Breaking, and what comes back                                               */
/* -------------------------------------------------------------------------- */

test('what comes back is the part you did not get through', () => {
  /*
   * The proportional refund. Paying for a whole thing and losing it entirely
   * would make interruption feel like robbery; refunding it in full would make
   * interrupting a caster pointless. The proportion is what makes both sides
   * of that exchange worth playing.
   *
   * Eight ticks long, two ticks in, ten mana paid → six eighths unspent → 8 back.
   */
  const early = midCast(2, { abilities: abilities({ con: 1 }) });
  const broken = breakCast(d20Sequence(1), early, 20);

  assert.equal(broken.broken, true);
  assert.equal(broken.refunded, 8, 'six of eight ticks unspent, so six eighths of ten');
  assert.equal(broken.who.mana, 18);
  assert.equal(isCasting(broken.who), false);
});

test('broken on the last tick returns almost nothing', () => {
  const late = midCast(7, { abilities: abilities({ con: 1 }) });
  const broken = breakCast(d20Sequence(1), late, 20);
  assert.equal(broken.refunded, 1, 'one of eight ticks unspent');
});

test('a refund never overfills the pool', () => {
  const nearlyFull = midCast(1, { mana: 29, maxMana: 30, abilities: abilities({ con: 1 }) });
  const broken = breakCast(d20Sequence(1), nearlyFull, 20);
  assert.ok(broken.who.mana <= 30);
});

test('the refund goes back to the pool it came out of', () => {
  const physical = advanceCast(beginCast(caster({ abilities: abilities({ con: 1 }) }), 'heave', 'orc', 8, 10, 'stamina'), 2).who;
  const broken = breakCast(d20Sequence(1), physical, 20);
  assert.equal(broken.who.stamina, 18);
  assert.equal(broken.who.mana, 10, 'the mind should be untouched');
});

/* -------------------------------------------------------------------------- */
/* Holding on, which is what CON is for                                        */
/* -------------------------------------------------------------------------- */

test('a steady caster holds it', () => {
  /*
   * CON's second job, and the one its own description promised from the
   * beginning: "maintain focus on spells". It sets the mana ceiling AND
   * decides whether the big thing actually lands.
   */
  const steady = midCast(2, { abilities: abilities({ con: 18 }) });
  const held = breakCast(d20Sequence(20), steady, 10);

  assert.equal(held.broken, false);
  assert.equal(held.refunded, 0);
  assert.equal(isCasting(held.who), true, 'the cast should still be going');
});

test('a heavier blow is harder to hold against', () => {
  // Ten, or half the damage, whichever is worse — so a scratch rarely breaks
  // concentration and a serious blow usually does.
  assert.equal(holdDC(4), 10, 'a scratch is still the floor');
  assert.equal(holdDC(30), 15);
  assert.ok(holdDC(60) > holdDC(30));
});

test('somebody who is not casting cannot be interrupted', () => {
  const idle = caster();
  const nothing = breakCast(d20Sequence(1), idle, 40);
  assert.equal(nothing.broken, false);
  assert.equal(nothing.refunded, 0);
  assert.deepEqual(nothing.who, idle, 'and nothing about them changes');
});
