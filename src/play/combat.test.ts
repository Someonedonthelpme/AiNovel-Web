import test from 'node:test';
import assert from 'node:assert/strict';
import { currentActor } from '../combat/combat.ts';
import {
  ARENA_SIZE, arenaFor, awaitingPlayer, beginEncounter, combatOptions,
  concludeCombat, foeSpecies, notableEvents, takeCombatAction,
} from './combat.ts';
import { scaleFoe } from '../combat/statblock.ts';
import { ABILITIES } from '../combat/types.ts';
import { speciesFor } from '../character/species.ts';
import type { CombatAction } from './combat.ts';
import { applyDelta, applyTurn, foldPlay, settleFight, validateDelta } from './delta.ts';
import { xpToNext } from './progress.ts';
import { COUNTERS } from './traits.ts';
import { counterOf } from '../character/persona.ts';
import { believes } from '../character/belief.ts';
import { PLAYER } from '../social/edge.ts';
import { STANDARD } from '../rules/ruleset.ts';
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

/**
 * A fight the party actually wins.
 *
 * `onFloorTwo` is a level-one character against a danger-8 floor and LOSES —
 * which quietly turned every `if (victor === 'party')` guard below into a test
 * that asserts nothing. Anything about what a win pays has to start here.
 */
function winnable(over: Partial<PlayState> = {}): PlayState {
  const floor: Region = {
    ...groundFloor(),
    id: 'floor-2', floor: 2, danger: 1, name: 'The Shallow Steps',
    creatures: ['หนูยักษ์'],
  };
  // Level 2 on floor 2, because `depthFactor` pays almost nothing for a fight
  // far below your level — a level-8 character on floor 1 wins and earns ZERO,
  // which would make any test about what a win pays vacuous a second time.
  const base = playState();
  return {
    ...base,
    world: { ...base.world, currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' },
    sheet: { ...base.sheet, level: 2 },
    pc: { ...base.pc, hp: 200, maxHp: 200 },
    ...over,
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

test('a world that forbids levelling holds the line at the fight payout too', () => {
  // The other half of the progression law. A law honoured by the climb and not
  // by combat would be no law at all — which is why the guard lives inside
  // `grantXp` and this only proves the fight actually asks.
  const base = winnable();
  const brink = { ...base, sheet: { ...base.sheet, xp: xpToNext(base.sheet.level) - 1 } };
  const capped = {
    ...brink,
    world: { ...brink.world, rules: { ...STANDARD, laws: [
      { axis: 'progression' as const, constraint: 'gainLevels' as const, binds: 'all' as const },
    ] } },
  };

  const free = concludeCombat(fightItOut(beginEncounter(brink)).state);
  const held = concludeCombat(fightItOut(beginEncounter(capped)).state);

  assert.equal(free.victor, 'party', 'the fixture has to WIN or this test asserts nothing');
  assert.ok(free.state.sheet.level > brink.sheet.level, 'that win is a level in an ordinary world');
  assert.equal(held.state.sheet.level, brink.sheet.level, 'and none at all under the law');
  assert.ok((held.state.sheet.xp ?? 0) > (brink.sheet.xp ?? 0), 'the experience is banked, not burnt');
});

test('a world where the tower keeps its own gives up no loot and no coin', () => {
  // The economy axis: what may be taken is the world's law. The dead still fall
  // and the fight still counts — nothing follows you out of the room.
  const base = winnable();
  const kept = {
    ...base,
    world: { ...base.world, rules: { ...STANDARD, laws: [
      { axis: 'economy' as const, constraint: 'takeLoot' as const, binds: 'all' as const },
    ] } },
  };

  const free = concludeCombat(fightItOut(beginEncounter(base)).state);
  const barren = concludeCombat(fightItOut(beginEncounter(kept)).state);
  assert.equal(free.victor, 'party', 'the fixture has to WIN or this test asserts nothing');

  assert.ok(free.loot.length > 0 || free.coin > 0, 'an ordinary win pays something');
  assert.deepEqual(barren.loot, [], 'nothing drops where the law forbids taking');
  assert.equal(barren.coin, 0);
  assert.ok((barren.state.sheet.counters['kills'] ?? 0) > 0, 'the fight still happened');
});

test('a fight pays from the stratum it happens in', () => {
  // The wire, not the roll: `rollLoot` learned about profiles in isolation, and
  // this is what proves the fight actually asks the structure it is standing in.
  const base = winnable();
  const ordinary = concludeCombat(fightItOut(beginEncounter(base)).state);
  assert.equal(ordinary.victor, 'party', 'the fixture has to WIN or this test asserts nothing');
  assert.ok(ordinary.loot.length > 0, 'an ordinary wing pays something');

  const hoarding = {
    ...base,
    world: {
      ...base.world,
      strata: { vault: {
        id: 'vault', name: 'The Locked Vault', kind: 'dynamic' as const, from: 0,
        loot: { weights: {
          rations: 0, draught: 0, weapon: 0, armour: 0, pack: 0, part: 0, material: 0, book: 0,
        } },
      } },
    },
  };
  const kept = concludeCombat(fightItOut(beginEncounter(hoarding)).state);

  assert.deepEqual(kept.loot, [], 'a wing that gives up nothing gives up nothing');
  assert.ok(kept.coin > 0, 'coin is not part of the profile — the body is still worth robbing');
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

test('a kill is a deed the people standing there saw', () => {
  const start = winnable();
  const { actions } = fightItOut(openFight(start));
  const after = applyTurn(start, combatTurn(actions)).state;
  assert.ok(counterOf(after.sheet.counters, COUNTERS.kills) > 0, 'something has to have died');
  assert.ok(believes(after.world.people['smith'].beliefs ?? [], { kind: 'deed', who: PLAYER, what: 'killed' }));
});

test('a fight played live ends exactly where its replay does', () => {
  const start = winnable();
  const draft: TurnRecord = { ...combatTurn([]), combatActions: undefined };
  const { actions } = fightItOut(applyTurn(start, draft).state);   // driven as the server drives it
  const live = settleFight({ pre: start, draft, actions });
  assert.deepEqual(live.state, foldPlay(start, [live.record]));
});

const ambush: TurnRecord = { ...combatTurn([]), combatActions: undefined, delta: { startCombat: true, startedBy: 'them' } };

test('whoever struck first acts first', () => {
  let playerWouldLead = false;
  for (let seed = 0; seed < 12; seed++) {
    const base = onFloorTwo();
    const start = { ...base, world: { ...base.world, seed, turn: seed } };
    playerWouldLead ||= beginEncounter(applyDelta(start, { startCombat: true })).combat!.order[0] === 'pc';
    const { order, combatants } = applyTurn(start, ambush).state.combat!;
    const firstParty = order.findIndex((id) => combatants[id].side === 'party');
    assert.ok(order.slice(firstParty).every((id) => combatants[id].side === 'party'), `seed ${seed}: a foe acted after you`);
  }
  assert.ok(playerWouldLead, 'no seed where the player would have gone first — the test proves nothing');
});

test('being jumped means being struck before you can move', () => {
  // Acting first across an open arena only spends the turn closing the gap —
  // which measured as an ambush RAISING the player's win rate.
  for (let seed = 0; seed < 12; seed++) {
    const base = onFloorTwo();
    const start = { ...base, world: { ...base.world, seed, turn: seed } };
    const { log, combatants } = applyTurn(start, ambush).state.combat!;
    assert.ok(log.some((e) => e.kind === 'attack' && combatants[e.attacker]?.side === 'foe'), `seed ${seed}: nobody struck`);
  }
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

test('a boss is every tenth FLOOR, not every tenth danger level', () => {
  // Step 6 decoupled danger from depth, and `kindForFloor` kept being handed
  // danger — so a steep world met bosses early and a quiet one never did.
  const at = (floor: number, danger: number): PlayState => {
    const base = playState();
    const region: Region = { ...groundFloor(), id: `floor-${floor}`, floor, danger, creatures: [] };
    return { ...base, world: { ...base.world, currentRegion: region.id, regions: { [region.id]: region }, currentPlace: 'town' } };
  };
  // With no creature names, a foe is called by its role.
  const foes = (s: PlayState) =>
    Object.values(beginEncounter(s).combat?.combatants ?? {}).filter((c) => c.side !== 'party').map((c) => c.name);

  assert.ok(!foes(at(5, 10)).includes('boss'), 'danger 10 on floor 5 is no landmark');
  assert.ok(foes(at(10, 1)).includes('boss'), 'floor 10 is, however quiet');
});

test('a mass foe carries its species\' body on top of its role and danger', () => {
  const base = onFloorTwo();                                 // danger 8 → one 'elite' หมาป่าเงา
  const start = { ...base, world: { ...base.world, species: speciesFor(1) } };
  const kind = foeSpecies(start.world, 'หมาป่าเงา');
  // Without these, a foeSpecies that returned an empty template passed.
  assert.ok(start.world.species.some((k) => k.id === kind.id), 'one of the kinds this world holds');
  assert.ok(Object.values(kind.template).some((v) => v !== 0), 'a template that moves something');
  const foe = Object.values(beginEncounter(start).combat!.combatants).find((c) => c.side === 'foe')!;
  for (const a of ABILITIES) assert.equal(foe.abilities[a], scaleFoe(8, 'elite').abilities[a] + (kind.template[a] ?? 0), a);
});
