import test from 'node:test';
import assert from 'node:assert/strict';
import { autoTurn } from '../combat/ai.ts';
import { startCombat } from '../combat/combat.ts';
import { beginCast, isCasting } from '../combat/cast.ts';
import { hasCondition, tickConditions } from '../combat/conditions.ts';
import { combatant, maxRolls, sword } from '../combat/fixtures.ts';
import type { Combatant, Grid } from '../combat/types.ts';
import { resolveSkill } from './active.ts';
import type { ActiveSkill } from './active.ts';
import { flat, instant, self, single, SPECIAL_VERBS } from './effect.ts';
import type { Effect, SpecialVerb } from './effect.ts';

/**
 * The verbs, for the things that are not a number moving.
 *
 * The registry's own rule is that a verb exists only once something can carry
 * it out — so this file IS the entry condition. A verb with no test here is a
 * verb with no resolver, and that is the dead-field bug in a new hat.
 */

const verb = (v: SpecialVerb, rounds = 1): Effect => {
  const aim = v === 'cleanse'
    ? { sign: 'plus' as const, who: 'own' as const, shape: self }
    : { sign: 'minus' as const, who: 'foe' as const, shape: single };
  return {
    role: 'purpose', channel: 'special', verb: v, formula: flat(rounds),
    duration: v === 'taunt' ? { kind: 'rounds', rounds } : instant,
    ...aim,
  };
};

const skill = (v: SpecialVerb, rounds = 1): ActiveSkill =>
  ({ id: `sk_${v}`, name: v, description: '', ability: 'dex', effects: [verb(v, rounds)], range: 2 });

const me = () => ({ ...combatant('pc'), name: 'Anan' });

/* -------------------------------------------------------------------------- */
/* Every verb in the registry has a resolver                                   */
/* -------------------------------------------------------------------------- */

test('EVERY declared verb changes something', () => {
  /*
   * The generalisation of the writer/reader proof onto the verb registry. A
   * verb the engine cannot carry out would be composed, priced, shown to the
   * player and then do nothing — silently, for ever.
   */
  const casting = beginCast({ ...combatant('foe1'), side: 'foe' }, 'x', null, 8, 6, 'mana');
  const afflicted = { ...combatant('foe2'), side: 'foe' as const, conditions: [{ kind: 'prone' as const, roundsLeft: 2 }] };

  for (const v of SPECIAL_VERBS) {
    const target = v === 'cleanse' ? { ...afflicted, side: 'party' as const } : casting;
    const out = resolveSkill(skill(v, 2), v === 'cleanse' ? target : me(), v === 'cleanse' ? [] : [target]);
    const touched = v === 'cleanse' ? out.actor : out.affected[0];
    assert.notDeepEqual(touched, target, `"${v}" is declared and resolves to nothing`);
  }
});

test('displace is deliberately NOT in the registry', () => {
  // Shoving somebody needs the board — where the walls are, who is standing
  // where — and the resolver is handed a combatant, not a grid. It goes in
  // when the grid reaches it, and not before.
  assert.equal((SPECIAL_VERBS as readonly string[]).includes('displace'), false);
});

/* -------------------------------------------------------------------------- */
/* What each one actually does                                                 */
/* -------------------------------------------------------------------------- */

test('interrupt breaks a wind-up outright, with no roll to hold it', () => {
  /*
   * The other route is `breakCast`: a blow lands and CON decides whether the
   * cast survives. A skill BUILT to interrupt does not ask — which is what
   * makes it worth a turn rather than being a worse attack.
   */
  const winding = beginCast({ ...combatant('foe1'), side: 'foe' }, 'big', null, 8, 6, 'mana');
  assert.equal(isCasting(winding), true);

  const out = resolveSkill(skill('interrupt'), me(), [winding]);
  assert.equal(isCasting(out.affected[0]), false);
});

test('interrupting somebody who is not casting is a wasted turn, not an error', () => {
  const idle = { ...combatant('foe1'), side: 'foe' as const };
  assert.deepEqual(resolveSkill(skill('interrupt'), me(), [idle]).affected[0], idle);
});

test('cleanse clears EVERYTHING, which is what makes it a verb', () => {
  // Naming one condition is what the condition channel already does, so the
  // verb has to be the wider move or it is a duplicate.
  const buried: Combatant = {
    ...me(),
    conditions: [{ kind: 'prone', roundsLeft: 2 }, { kind: 'poisoned', roundsLeft: 3 }],
  };
  const out = resolveSkill(skill('cleanse'), buried, []);
  assert.deepEqual(out.actor.conditions, []);
});

test('a taunt records WHO, which is the whole content of it', () => {
  const foe = { ...combatant('foe1'), side: 'foe' as const };
  const out = resolveSkill(skill('taunt', 2), me(), [foe]);
  assert.equal(out.affected[0].taunt?.by, 'pc');
  assert.ok((out.affected[0].taunt?.roundsLeft ?? 0) >= 1);
});

test('a taunt wears off on the same clock as the conditions', () => {
  // Two countdowns that could drift apart is one too many.
  const held: Combatant = { ...combatant('foe1'), taunt: { by: 'pc', roundsLeft: 2 }, conditions: [{ kind: 'prone', roundsLeft: 2 }] };
  const once = tickConditions(held);
  assert.equal(once.taunt?.roundsLeft, 1);
  assert.equal(hasCondition(once, 'prone'), true);

  const twice = tickConditions(once);
  assert.equal(twice.taunt, undefined, 'it should be gone, not sitting at zero');
  assert.equal(hasCondition(twice, 'prone'), false);
});

/* -------------------------------------------------------------------------- */
/* The reader: a taunt that nothing acted on would be another dead field       */
/* -------------------------------------------------------------------------- */

/** A wounded ally the AI would otherwise finish, and a healthy one who taunted. */
function pack(taunted: boolean) {
  const bait = { ...combatant('bait'), name: 'bait', hp: 30, maxHp: 30, attacks: [sword], pos: { x: 1, y: 1 } };
  const dying = { ...combatant('dying'), name: 'dying', hp: 2, maxHp: 30, attacks: [sword], pos: { x: 2, y: 1 } };
  const foe: Combatant = {
    ...combatant('foe1'),
    name: 'wolf',
    side: 'foe',
    attacks: [sword],
    pos: { x: 2, y: 2 },
    ...(taunted ? { taunt: { by: 'bait', roundsLeft: 2 } } : {}),
  };
  const arena: Grid = { width: 8, height: 8, walls: new Set() };
  const started = startCombat(maxRolls, [foe, bait, dying], arena);
  // Hand the turn to the foe, with a round's worth of ticks: its TARGET CHOICE
  // is what is under test, not whose initiative came out on top.
  return {
    ...started,
    turn: started.order.indexOf('foe1'),
    combatants: { ...started.combatants, foe1: { ...started.combatants['foe1'], ticks: 6 } },
  };
}

test('the AI finishes the wounded — unless somebody made themselves the problem', () => {
  /*
   * The reader for `Combatant.taunt`. Without this the field would be written,
   * shown and ticked down by nobody's decision — the exact shape of the six
   * dead fields already on record.
   */
  const plain = autoTurn(maxRolls, pack(false));
  assert.ok(plain.combatants['dying'].hp < 2, 'the wounded one should have been finished');
  assert.equal(plain.combatants['bait'].hp, 30, 'and the healthy one left alone');

  const pulled = autoTurn(maxRolls, pack(true));
  assert.ok(pulled.combatants['bait'].hp < 30, 'a taunt should pull the attack onto the taunter');
  assert.equal(pulled.combatants['dying'].hp, 2, 'and off whoever was about to drop');
});
