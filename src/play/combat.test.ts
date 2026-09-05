import test from 'node:test';
import assert from 'node:assert/strict';
import { currentActor } from '../combat/combat.ts';
import {
  ARENA_SIZE, arenaFor, awaitingPlayer, beginEncounter, combatOptions,
  concludeCombat, notableEvents, takeCombatAction,
} from './combat.ts';
import type { CombatAction } from './combat.ts';
import { applyDelta, applyTurn, foldPlay, validateDelta } from './delta.ts';
import { playState } from './fixtures.ts';
import { groundFloor, world } from '../world/fixtures.ts';
import type { PlayState, TurnRecord } from './state.ts';
import type { Region } from '../world/types.ts';

/** A dangerous floor, since nothing hunts at ground level. */
function onFloorTwo(): PlayState {
  const floor: Region = {
    ...groundFloor(),
    id: 'floor-2', floor: 2, danger: 8, name: 'The Grey Grove',
    creatures: ['หมาป่าเงา'],
  };
  const base = playState();
  return {
    ...base,
    world: { ...base.world, currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' },
  };
}

/** Fight to a conclusion, always taking the first legal option. */
function fightItOut(start: PlayState, cap = 200) {
  let state = start;
  const actions: CombatAction[] = [];
  for (let i = 0; i < cap && state.combat && !state.combat.over; i++) {
    if (!awaitingPlayer(state)) break;
    const [option] = combatOptions(state);
    if (!option) break;
    actions.push(option.action);
    state = takeCombatAction(state, option.action).state;
  }
  return { state, actions };
}

/* -------------------------------------------------------------------------- */
/* The arena                                                                   */
/* -------------------------------------------------------------------------- */

test('the ground is deterministic — the same fight lays out the same way', () => {
  assert.deepEqual(arenaFor(42, 8).walls, arenaFor(42, 8).walls);
  assert.notDeepEqual(arenaFor(42, 8).walls, arenaFor(43, 8).walls);
});

test('obstacles never touch the edges, so nobody spawns boxed in', () => {
  for (const key of arenaFor(7, 30).walls) {
    const [x, y] = key.split(',').map(Number);
    assert.ok(x >= 3 && x <= ARENA_SIZE - 3, `wall too close to the edge: ${key}`);
    assert.ok(y >= 3 && y <= ARENA_SIZE - 3, `wall too close to the edge: ${key}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Starting a fight                                                            */
/* -------------------------------------------------------------------------- */

test('an encounter puts the character in with what lives on the floor', () => {
  const state = beginEncounter(onFloorTwo());
  assert.ok(state.combat);
  const sides = Object.values(state.combat.combatants);
  assert.ok(sides.some((c) => c.id === 'pc' && c.side === 'party'));
  assert.ok(sides.some((c) => c.side === 'foe'));
  assert.ok(sides.filter((c) => c.side === 'foe').every((c) => c.name === 'หมาป่าเงา'));
});

test('the character brings their wounds into the fight', () => {
  const hurt = { ...onFloorTwo(), pc: { ...onFloorTwo().pc, hp: 3 } };
  const state = beginEncounter(hurt);
  assert.equal(state.combat?.combatants['pc'].hp, 3, 'a fight does not heal you first');
});

test('nothing hunts at ground level', () => {
  const r = validateDelta(playState(), { startCombat: true });
  assert.equal(r.delta.startCombat, undefined);
  assert.match(r.rejected[0], /ground level/);
});

test('a fight is allowed on a dangerous floor', () => {
  const r = validateDelta(onFloorTwo(), { startCombat: true });
  assert.equal(r.delta.startCombat, true);
  assert.deepEqual(r.rejected, []);
});

test('a second fight cannot start on top of the first', () => {
  const fighting = beginEncounter(onFloorTwo());
  assert.match(validateDelta(fighting, { startCombat: true }).rejected[0], /already happening/);
});

/* -------------------------------------------------------------------------- */
/* Acting                                                                      */
/* -------------------------------------------------------------------------- */

test('every offered option is legal', () => {
  const state = beginEncounter(onFloorTwo());
  for (const option of combatOptions(state)) {
    assert.equal(takeCombatAction(state, option.action).error, null, `illegal option: ${option.label}`);
  }
});

test('acting out of turn is refused', () => {
  const state = beginEncounter(onFloorTwo());
  if (awaitingPlayer(state)) return; // the player happened to win initiative
  assert.match(takeCombatAction(state, { kind: 'end' }).error ?? '', /not your move/);
});

test('one decision returns control, however many foes are on the board', () => {
  let state = beginEncounter(onFloorTwo());
  while (!awaitingPlayer(state) && state.combat && !state.combat.over) {
    state = takeCombatAction(state, { kind: 'end' }).state;
  }
  if (!awaitingPlayer(state)) return;

  const step = takeCombatAction(state, { kind: 'end' });
  assert.equal(step.error, null);
  assert.ok(
    step.state.combat?.over || awaitingPlayer(step.state),
    'after acting it should be your move again, or the fight should be finished',
  );
  assert.ok(step.events.length > 0, 'and something should have happened in between');
});

test('a fight always reaches a conclusion', () => {
  const { state } = fightItOut(beginEncounter(onFloorTwo()));
  assert.equal(state.combat?.over, true);
  assert.notEqual(state.combat?.victor, null);
});

/* -------------------------------------------------------------------------- */
/* Consequences                                                                */
/* -------------------------------------------------------------------------- */

test('wounds persist and kills are counted', () => {
  const { state } = fightItOut(beginEncounter(onFloorTwo()));
  const outcome = concludeCombat(state);

  assert.equal(outcome.state.combat, null, 'a finished fight is not state');
  assert.ok(outcome.state.pc.hp <= state.pc.maxHp);
  if (outcome.victor === 'party') {
    assert.ok((outcome.state.sheet.counters['kills'] ?? 0) > 0, 'kills feed the tallies traits will read');
    assert.equal(outcome.state.sheet.counters['fights_won'], 1);
  }
});

test('losing ends the run rather than killing you outright', () => {
  const doomed = { ...onFloorTwo(), pc: { ...onFloorTwo().pc, hp: 1 } };
  const { state } = fightItOut(beginEncounter(doomed));
  const outcome = concludeCombat(state);
  if (outcome.victor === 'foe') {
    assert.equal(outcome.state.ended?.reason, 'defeated');
    assert.equal(outcome.state.pc.hp, 0);
  }
});

/* -------------------------------------------------------------------------- */
/* Replay                                                                      */
/* -------------------------------------------------------------------------- */

const combatTurn = (actions: CombatAction[]): TurnRecord => ({
  kind: 'turn', input: 'something lunges', mode: 'exploration', classification: 'ADVANCES',
  addressed: null, roll: null, delta: { startCombat: true }, rejected: [], prose: '',
  combatActions: actions,
});

/**
 * The seed for a fight includes `world.turn`, which `applyDelta` advances before
 * the encounter opens. Actions therefore have to be chosen from the POST-delta
 * state — which is exactly what the live loop does.
 */
const openFight = (state: PlayState) => beginEncounter(applyDelta(state, { startCombat: true }));

test('a whole fight is one event, and replays identically', () => {
  // Only the decisions are stored; every roll comes from state. If that were not
  // true, reloading a session would re-fight the same encounter differently.
  const start = onFloorTwo();
  const { actions } = fightItOut(openFight(start));

  const once = applyTurn(start, combatTurn(actions)).state;
  const twice = applyTurn(start, combatTurn(actions)).state;

  assert.deepEqual(once.pc, twice.pc);
  assert.deepEqual(once.sheet.counters, twice.sheet.counters);
  assert.deepEqual(once.ended, twice.ended);
});

test('replaying a fight from the log reaches the same place as playing it', () => {
  const start = onFloorTwo();
  const live = fightItOut(openFight(start));
  const played = concludeCombat(live.state);
  const replayed = foldPlay(start, [combatTurn(live.actions)]);

  assert.equal(replayed.pc.hp, played.state.pc.hp, 'the log must reproduce the fight that was fought');
  assert.deepEqual(replayed.sheet.counters, played.state.sheet.counters);
  assert.deepEqual(replayed.ended, played.state.ended);
});

test('a fight leaves nothing half-finished behind it', () => {
  const start = onFloorTwo();
  const { actions } = fightItOut(openFight(start));
  assert.equal(applyTurn(start, combatTurn(actions)).state.combat, null);
});

/* -------------------------------------------------------------------------- */
/* Narration                                                                   */
/* -------------------------------------------------------------------------- */

test('only turning points are worth narrating', () => {
  const said = notableEvents([
    { kind: 'attack', attacker: 'pc', target: 'wolf', attackName: 'sword',
      roll: { dice: [9], natural: 9, modifier: 2, total: 11, advantage: 'none' },
      hit: true, critical: false, damage: 3, damageType: 'x', damageDice: [3],
      targetHpBefore: 20, targetHpAfter: 17, droppedTarget: false, killedTarget: false },
    { kind: 'attack', attacker: 'pc', target: 'wolf', attackName: 'sword',
      roll: { dice: [20], natural: 20, modifier: 2, total: 22, advantage: 'none' },
      hit: true, critical: true, damage: 12, damageType: 'x', damageDice: [6, 6],
      targetHpBefore: 17, targetHpAfter: 5, droppedTarget: false, killedTarget: false },
    { kind: 'combatEnd', victor: 'party' },
  ]);

  assert.equal(said.length, 2, 'the ordinary hit is left to the numbers');
  assert.match(said[0], /devastating/);
  assert.match(said[said.length - 1], /standing/);
});

test('a fight with nothing remarkable in it produces no narration', () => {
  assert.deepEqual(notableEvents([{ kind: 'roundStart', round: 2 }, { kind: 'turnStart', actor: 'pc' }]), []);
});

test('a live turn opens the fight and hands control back', () => {
  // Without this the fight would begin and immediately conclude with nobody
  // having swung anything.
  const live: TurnRecord = { ...combatTurn([]), combatActions: undefined };
  const state = applyTurn(onFloorTwo(), live).state;
  assert.ok(state.combat, 'the fight should still be running');
  assert.equal(state.combat?.over, false);
});

test('a fight that opens on the foe side still hands you a move', () => {
  // Observed: when something won initiative, the encounter opened and then sat
  // there, because nobody advanced past the enemy turn.
  for (let seed = 0; seed < 12; seed++) {
    const base = onFloorTwo();
    const start = { ...base, world: { ...base.world, seed, turn: seed } };
    const opened = beginEncounter(start);
    assert.ok(
      opened.combat?.over || awaitingPlayer(opened),
      `seed ${seed}: the fight opened with nobody able to act`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Pools survive a fight                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The regression: `toCombatant` fills the pools to their ceilings, which is
 * right for a foe drawn from a statblock and wrong for the player. Nothing
 * carried the spent pools IN and nothing carried them back OUT, so every
 * encounter opened full however hard the last one had been — and the scarcity
 * the whole stamina/mana economy exists to create never happened.
 */

test('a fight opens with the pools you actually have, not full ones', () => {
  const worn = onFloorTwo();
  const spent: PlayState = { ...worn, pc: { ...worn.pc, stamina: 2, mana: 1 } };

  const me = beginEncounter(spent).combat!.combatants['pc'];
  assert.equal(me.stamina, 2, 'a tired climber starts the fight tired');
  assert.equal(me.mana, 1);
  assert.ok(me.maxStamina > 2, 'the ceiling is unchanged — only what is in the pool moved');
});

test('what a fight costs is still gone when it ends', () => {
  const start = onFloorTwo();
  const fought = fightItOut(beginEncounter(start));
  const done = concludeCombat(fought.state);

  const me = fought.state.combat?.combatants['pc'];
  if (!me) return; // the encounter cleared before anyone could spend

  assert.equal(done.state.pc.stamina, me.stamina, 'stamina is carried back out');
  assert.equal(done.state.pc.mana, me.mana, 'and so is mana');
});

test('a pool never comes back above its ceiling by fighting', () => {
  const start = onFloorTwo();
  const done = concludeCombat(fightItOut(beginEncounter(start)).state);
  assert.ok(done.state.pc.stamina <= start.pc.stamina, 'a fight cannot refill you');
  assert.ok(done.state.pc.mana <= start.pc.mana);
});
