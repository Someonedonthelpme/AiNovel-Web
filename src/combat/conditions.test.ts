import test from 'node:test';
import assert from 'node:assert/strict';
import { addCondition, attackModifiers, effectiveSpeed, hasCondition, isIncapacitated, removeCondition, tickConditions, MIN_ROUNDS,
} from './conditions.ts';
import { abilities, combatant } from './fixtures.ts';

test('conditions can be added, found and removed', () => {
  let c = combatant('a');
  assert.equal(hasCondition(c, 'prone'), false);
  c = addCondition(c, 'prone');
  assert.equal(hasCondition(c, 'prone'), true);
  c = removeCondition(c, 'prone');
  assert.equal(hasCondition(c, 'prone'), false);
});

test('timed conditions expire; permanent ones do not', () => {
  let c = addCondition(addCondition(combatant('a'), 'poisoned', 2), 'prone', null);
  c = tickConditions(c);
  assert.equal(hasCondition(c, 'poisoned'), true, 'still one round left');
  c = tickConditions(c);
  assert.equal(hasCondition(c, 'poisoned'), false, 'expired');
  assert.equal(hasCondition(c, 'prone'), true, 'permanent conditions never tick away');
});

test('re-applying a condition refreshes its duration without duplicating it', () => {
  let c = addCondition(combatant('a'), 'poisoned', 1);
  c = addCondition(c, 'poisoned', 5);
  assert.equal(c.conditions.filter((x) => x.kind === 'poisoned').length, 1);
  c = tickConditions(c);
  assert.equal(hasCondition(c, 'poisoned'), true, 'the refreshed duration applies');
});

test('incapacitating conditions zero the speed', () => {
  assert.equal(effectiveSpeed(combatant('a', { speed: 6 })), 6);
  assert.equal(effectiveSpeed(addCondition(combatant('a'), 'restrained')), 0);
  assert.equal(effectiveSpeed(addCondition(combatant('a'), 'grappled')), 0);
  assert.equal(effectiveSpeed(addCondition(combatant('a'), 'stunned')), 0);
  assert.equal(effectiveSpeed(combatant('a', { dying: true })), 0);
});

test('prone is not incapacitating and does not stop movement', () => {
  const c = addCondition(combatant('a'), 'prone');
  assert.equal(isIncapacitated(c), false);
  assert.equal(effectiveSpeed(c), 6);
});

test('prone helps melee attackers and hurts ranged ones', () => {
  const attacker = combatant('a');
  const target = addCondition(combatant('b', { side: 'foe' }), 'prone');
  assert.equal(attackModifiers(attacker, target, 1).advantage, 'advantage', 'melee');
  assert.equal(attackModifiers(attacker, target, 6).advantage, 'disadvantage', 'ranged');
});

test('an attacker who is prone themselves has disadvantage', () => {
  const attacker = addCondition(combatant('a'), 'prone');
  const target = combatant('b', { side: 'foe' });
  assert.equal(attackModifiers(attacker, target, 1).advantage, 'disadvantage');
});

test('opposing sources of advantage cancel out', () => {
  // Attacker prone (disadvantage) vs target prone in melee (advantage).
  const attacker = addCondition(combatant('a'), 'prone');
  const target = addCondition(combatant('b', { side: 'foe' }), 'prone');
  assert.equal(attackModifiers(attacker, target, 1).advantage, 'none');
});

test('helpless targets grant advantage, and auto-crit in melee only', () => {
  const attacker = combatant('a');
  const target = addCondition(combatant('b', { side: 'foe' }), 'unconscious');
  const melee = attackModifiers(attacker, target, 1);
  assert.equal(melee.advantage, 'advantage');
  assert.equal(melee.autoCrit, true);
  assert.equal(attackModifiers(attacker, target, 5).autoCrit, false, 'not from across the room');
});

test('a blinded attacker attacking a blinded target cancels out', () => {
  const attacker = addCondition(combatant('a'), 'blinded');
  const target = addCondition(combatant('b', { side: 'foe' }), 'blinded');
  assert.equal(attackModifiers(attacker, target, 1).advantage, 'none');
});

/* -------------------------------------------------------------------------- */
/* Shrugging it off — VIT and CON resist, by duration                           */
/* -------------------------------------------------------------------------- */

/*
 * `resolveSave` exists and is called by nothing but its own tests, so
 * conditions have always landed unconditionally and neither VIT's "stun
 * resistance" nor CON's "poison" claim was implemented. Resistance shortens a
 * duration instead of rolling: `addCondition` is pure and has no Rng, and
 * shortening replays for free.
 */

test('a tough body is stunned for less time', () => {
  const soft = combatant('soft', { abilities: abilities({ vit: 8 }) });
  const hard = combatant('hard', { abilities: abilities({ vit: 18 }) });
  const left = (c: typeof soft) => addCondition(c, 'stunned', 4).conditions[0].roundsLeft;
  assert.ok((left(hard) ?? 0) < (left(soft) ?? 0));
});

test('a steady mind shakes off poison sooner', () => {
  const soft = combatant('soft', { abilities: abilities({ con: 8 }) });
  const hard = combatant('hard', { abilities: abilities({ con: 18 }) });
  const left = (c: typeof soft) => addCondition(c, 'poisoned', 4).conditions[0].roundsLeft;
  assert.ok((left(hard) ?? 0) < (left(soft) ?? 0));
});

test('the body and the mind resist different things', () => {
  const body = combatant('body', { abilities: abilities({ vit: 18, con: 8 }) });
  assert.equal(addCondition(body, 'poisoned', 4).conditions[0].roundsLeft, 4, 'a strong back is no help against poison');
});

test('resistance is never immunity', () => {
  const titan = combatant('titan', { abilities: abilities({ vit: 20, con: 20 }) });
  assert.equal(addCondition(titan, 'stunned', 2).conditions[0].roundsLeft, MIN_ROUNDS);
  assert.equal(addCondition(titan, 'poisoned', 1).conditions[0].roundsLeft, MIN_ROUNDS);
});

test('a permanent condition is not shortened — it is a state, not a timer', () => {
  const titan = combatant('titan', { abilities: abilities({ vit: 20 }) });
  assert.equal(addCondition(titan, 'unconscious', null).conditions[0].roundsLeft, null);
});
