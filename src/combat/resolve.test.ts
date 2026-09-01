import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDamage, attackBonus, resolveAttack, resolveSave, rollDeathSave } from './resolve.ts';
import { addCondition } from './conditions.ts';
import { combatant, d20Sequence, abilities } from './fixtures.ts';

const foe = (over = {}) => combatant('foe', { side: 'foe', ...over });

test('attack bonus is ability modifier plus proficiency when proficient', () => {
  const a = combatant('a', { abilities: abilities({ str: 16 }), proficiency: 3 });
  assert.equal(attackBonus(a, 'sword'), 6, '+3 str, +3 proficiency');
  const unskilled = { ...a, attacks: [{ ...a.attacks[0], proficient: false }] };
  assert.equal(attackBonus(unskilled, 'sword'), 3);
});

test('a natural 1 always misses, however large the bonus', () => {
  const a = combatant('a', { abilities: abilities({ str: 20 }), proficiency: 6 });
  const t = foe({ ac: 1 });
  const r = resolveAttack(d20Sequence(1), a, t, 'sword');
  assert.equal(r.event.hit, false);
  assert.equal(r.event.damage, 0);
  assert.equal(r.target.hp, t.hp, 'no damage on a miss');
});

test('a natural 20 always hits and always crits, however high the AC', () => {
  const r = resolveAttack(d20Sequence(20), combatant('a'), foe({ ac: 99 }), 'sword');
  assert.equal(r.event.hit, true);
  assert.equal(r.event.critical, true);
  assert.equal(r.event.damageDice.length, 2, 'crit doubles the dice');
});

test('a hit needs total at or above AC', () => {
  const a = combatant('a', { abilities: abilities({ str: 14 }), proficiency: 2 }); // +4
  assert.equal(resolveAttack(d20Sequence(11), a, foe({ ac: 15 }), 'sword').event.hit, true, '11+4 = 15');
  assert.equal(resolveAttack(d20Sequence(10), a, foe({ ac: 15 }), 'sword').event.hit, false, '10+4 = 14');
});

test('damage reduces hit points and is reported honestly', () => {
  const t = foe({ hp: 20, ac: 1 });
  const r = resolveAttack(d20Sequence(15), combatant('a'), t, 'sword');
  assert.equal(r.event.targetHpBefore, 20);
  assert.equal(r.event.targetHpAfter, 20 - r.event.damage);
  assert.equal(r.target.hp, r.event.targetHpAfter);
});

test('a foe reduced to 0 HP simply dies', () => {
  const dropped = applyDamage(foe({ hp: 3 }), 10);
  assert.equal(dropped.hp, 0);
  assert.equal(dropped.dead, true);
  assert.equal(dropped.dying, false);
});

test('a party member reduced to 0 HP falls unconscious and starts dying', () => {
  const dropped = applyDamage(combatant('hero', { side: 'party', hp: 3 }), 10);
  assert.equal(dropped.hp, 0);
  assert.equal(dropped.dead, false, 'players do not die outright');
  assert.equal(dropped.dying, true);
  assert.ok(dropped.conditions.some((c) => c.kind === 'unconscious'));
  assert.deepEqual(dropped.deathSaves, { successes: 0, failures: 0 });
});

test('hitting a dying character in melee is an automatic critical', () => {
  const down = applyDamage(combatant('hero', { side: 'party', hp: 1 }), 5);
  // Natural 12 + 2 clears AC 12 without being a natural 20, so the critical can
  // only come from the target being helpless.
  const r = resolveAttack(d20Sequence(12), foe(), down, 'sword');
  assert.equal(r.event.hit, true);
  assert.equal(r.event.roll.natural, 12, 'not a natural 20');
  assert.equal(r.event.critical, true, 'helpless target in melee auto-crits');
  assert.equal(r.event.damageDice.length, 2);
});

test('death saves: 10 or better succeeds, under 10 fails', () => {
  const dying = combatant('hero', { dying: true, hp: 0 });
  assert.equal(rollDeathSave(d20Sequence(10), dying).event.outcome, 'success');
  assert.equal(rollDeathSave(d20Sequence(9), dying).event.outcome, 'failure');
});

test('a natural 1 on a death save counts as two failures', () => {
  const r = rollDeathSave(d20Sequence(1), combatant('hero', { dying: true, hp: 0 }));
  assert.equal(r.event.outcome, 'criticalFailure');
  assert.equal(r.event.saves.failures, 2);
});

test('a natural 20 on a death save brings you back at 1 HP', () => {
  const dying = addCondition(combatant('hero', { dying: true, hp: 0 }), 'unconscious');
  const r = rollDeathSave(d20Sequence(20), dying);
  assert.equal(r.actor.hp, 1);
  assert.equal(r.actor.dying, false);
  assert.equal(r.actor.conditions.some((c) => c.kind === 'unconscious'), false);
  assert.equal(r.event.died, false);
});

test('three failures kills; three successes stabilises', () => {
  const dying = combatant('hero', { dying: true, hp: 0, deathSaves: { successes: 0, failures: 2 } });
  const dead = rollDeathSave(d20Sequence(5), dying);
  assert.equal(dead.event.died, true);
  assert.equal(dead.actor.dead, true);

  const nearly = combatant('hero', { dying: true, hp: 0, deathSaves: { successes: 2, failures: 0 } });
  const stable = rollDeathSave(d20Sequence(15), nearly);
  assert.equal(stable.event.stabilized, true);
  assert.equal(stable.actor.dead, false);
});

test('stunned creatures automatically fail strength and dexterity saves', () => {
  const stunned = addCondition(combatant('a', { abilities: abilities({ dex: 20 }) }), 'stunned');
  assert.equal(resolveSave(d20Sequence(20), stunned, 'dex', 5).event.success, false);
  assert.equal(resolveSave(d20Sequence(20), stunned, 'wis', 5).event.success, true, 'mental saves are unaffected');
});

test('poison imposes disadvantage on saves', () => {
  const poisoned = addCondition(combatant('a'), 'poisoned');
  const r = resolveSave(d20Sequence(18, 3), poisoned, 'con', 10);
  assert.equal(r.event.roll.advantage, 'disadvantage');
  assert.equal(r.event.roll.natural, 3, 'the worse die counts');
  assert.equal(r.event.success, false);
});
