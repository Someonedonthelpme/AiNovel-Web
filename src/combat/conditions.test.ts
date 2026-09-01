import test from 'node:test';
import assert from 'node:assert/strict';
import { addCondition, attackModifiers, effectiveSpeed, hasCondition, isIncapacitated, removeCondition, tickConditions } from './conditions.ts';
import { combatant } from './fixtures.ts';

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
