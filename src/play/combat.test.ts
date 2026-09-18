import test from 'node:test';
import assert from 'node:assert/strict';
import { currentActor } from '../combat/combat.ts';
import {
  ARENA_SIZE, arenaFor, awaitingPlayer, beginEncounter, breakPoint, combatOptions,
  concludeCombat, foeSpecies, notableEvents, takeCombatAction,
} from './combat.ts';
import { scaleFoe } from '../combat/statblock.ts';
import { composition, kindForFloor } from '../combat/encounter.ts';
import { ABILITIES } from '../combat/types.ts';
import { speciesFor, speciesIdFor, TYPES } from '../character/species.ts';
import { bandOf, groupsAt, habitOf, livesAt, packAt } from '../character/habitat.ts';
import { populationAt, sizeIn } from '../character/population.ts';
import { groupOf, leavesUnder, needScale } from '../character/species.ts';
import { preyOf } from '../character/prey.ts';
import type { CombatAction, CombatOption, ParleyEffect } from './combat.ts';
import { applyDelta, applyTurn, foldPlay, settleFight, validateDelta } from './delta.ts';
import { xpForFight, xpToNext } from './progress.ts';
import { COUNTERS } from './traits.ts';
import { counterOf, NEED_MAX } from '../character/persona.ts';
import { formRole } from '../social/roles.ts';
import { stationOf } from './station.ts';
import { believes, firsthand } from '../character/belief.ts';
import { axisOf, nudge, PLAYER } from '../social/edge.ts';
import { fadeDays, journeysOf, RECOVERY, setOut } from './journey.ts';
import { clockOf, linkCost, travelTime } from '../world/travel.ts';
import { calendarWords, dateOf, isNight, TICKS_PER_DAY } from '../world/calendar.ts';
import { runDirector, runParley } from '../llm/director.ts';
import { hearOf, newestSighting, sightingClaim } from './sighting.ts';
import { amend, STANDARD } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import { playState } from './fixtures.ts';
import { armour, weapon } from '../items/catalogue.ts';
import { addItem, emptyInventory, equip, equippedAttack } from '../items/types.ts';
import { armourClassFor, finalAbilities } from '../session/sheet.ts';
import { mulberry32 } from '../engine/roll.ts';
import { generatedFloor, groundFloor, world } from '../world/fixtures.ts';
import { generateFloor } from '../world/floorgen.ts';
import { FakeProvider } from '../llm/provider.ts';
import type { PlayState, TurnRecord, WorldDelta } from './state.ts';
import type { Person, Region } from '../world/types.ts';

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

/**
 * Fight to a conclusion, always taking the first legal option — through the fate
 * of anybody who yielded, since a fight is not finished until that is decided.
 */
function fightItOut(start: PlayState, cap = 200, pick = (options: CombatOption[]) => options[0]) {
  let state = start;
  const actions: CombatAction[] = [];
  for (let i = 0; i < cap && state.combat; i++) {
    if (!awaitingPlayer(state)) break;
    const option = pick(combatOptions(state));
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

/*
 * RESPECIFIED 2026-09-12, 6b stage 3n. Was: "a mass foe carries its species' body
 * on top of its role and danger" — there are no mass foes. A thing that fights is
 * a CHARACTER out of the floor's population, so what has to be true is that it has
 * a sheet's body and a standing anchored to the role it replaces; the template is
 * on it the way it is on any character, through `speciesTemplate`.
 */
test('a foe is a character out of the population on its floor', () => {
  const base = onFloorTwo();                                 // danger 8 → one 'elite'
  const start = { ...base, world: { ...base.world, seed: 11, species: speciesFor(11) } };

  const foe = Object.values(beginEncounter(start).combat!.combatants).find((c) => c.side === 'foe')!;
  const anchor = scaleFoe(8, 'elite').hp;

  assert.ok(foe.group, 'it is some kind of thing');
  assert.ok(Math.abs(foe.maxHp - anchor) <= anchor * 0.35, `${foe.maxHp} hp against an elite's ${anchor}`);
  assert.ok(foe.attacks.length > 0, 'and it fights with what its trade carries');
});

test('a world stored before kinds still meets the foes it always did', () => {
  // Inventing a population for an old world would be inventing the bodies of
  // creatures somebody is already fighting.
  const foe = Object.values(beginEncounter(onFloorTwo()).combat!.combatants).find((c) => c.side === 'foe')!;
  assert.equal(foe.maxHp, scaleFoe(8, 'elite').hp, 'the statblock, exactly as before');
  assert.equal(foe.group, undefined);
});
test('what you meet on a floor lives there, and a pack is one group', () => {
  const kinds = speciesFor(11);
  for (const floor of [2, 7, 14, 22]) {
    const base = onFloorTwo();
    const region = { ...base.world.regions['floor-2'], floor, danger: Math.max(1, floor), creatures: ['a', 'b', 'c'] };
    const start = { ...base, world: { ...base.world, seed: 11, species: kinds, regions: { 'floor-2': region } } };

    const foes = Object.values(beginEncounter(start).combat!.combatants).filter((c) => c.side === 'foe');
    const groups = new Set(foes.map((f) => groupOf(kinds, foeSpecies(start.world, f.name, floor).id)));
    assert.equal(groups.size, 1, `floor ${floor}: a pack from ${groups.size} different groups`);

    const [group] = [...groups];
    assert.ok(livesAt(11, kinds, group!, floor), `floor ${floor}: ${group} does not live there`);
  }
});

test('what hunts you has the edge in a real fight, both ways round', () => {
  const kinds = speciesFor(11);
  const groups = kinds.filter((n) => n.level === 'group');
  const hunter = groups.find((g) => preyOf(11, kinds, g.id))!;
  const quarry = preyOf(11, kinds, hunter.id)!;

  // A climber of the hunted kind, on a floor the hunters live on.
  const prey = leavesUnder(kinds, quarry)[0];
  const band = bandOf(11, kinds, hunter.id);
  const base = onFloorTwo();
  const region = { ...base.world.regions['floor-2'], floor: band.from, danger: 4, creatures: ['a'] };
  const start = {
    ...base,
    sheet: { ...base.sheet, species: prey.id },
    world: { ...base.world, seed: 11, species: kinds, regions: { 'floor-2': region } },
  };

  const combat = beginEncounter(start).combat!;
  assert.equal(combat.combatants['pc'].group, groupOf(kinds, prey.id), 'the climber is a kind of thing');

  const foe = Object.values(combat.combatants).find((c) => c.side === 'foe')!;
  assert.ok(foe.group, 'and so is what it meets');
  if (foe.group === hunter.id) assert.equal(foe.hunts, quarry, 'a hunter brings its appetite into the fight');
});

/*
 * 6b stage 3n-ii. A crowd is a population that KILLING THINS, so what a place
 * fields is what still lives there — and what a foe carries comes off the body
 * as the object it was, worn by the thing that carried it.
 */

/** `winnable` in a world with kinds. */
function winnableWithKinds(): PlayState {
  const base = winnable();
  return { ...base, world: { ...base.world, seed: 11, species: speciesFor(11) } };
}

/** A world with kinds, on a floor worth fighting on. */
function populated(over: Partial<PlayState['world']> = {}): PlayState {
  const base = onFloorTwo();
  return { ...base, world: { ...base.world, seed: 11, species: speciesFor(11), ...over } };
}

const foesOf = (state: PlayState) =>
  Object.values(state.combat?.combatants ?? {}).filter((c) => c.side === 'foe');

test('a place fields no more bodies than live there', () => {
  const start = populated();
  const floor = start.world.regions['floor-2'].floor;
  const full = foesOf(beginEncounter(start));
  assert.ok(full.length > 0, 'a populated place fields somebody');

  // Down to one living creature, whatever the depth thinks the fight is worth.
  const cohorts = populationAt(start.world, 'floor-2', 'town', floor)!;
  const one = [{ ...cohorts[0], size: 1 }];
  const thin = populated({ populations: { town: one } });

  const foes = foesOf(beginEncounter(thin));
  assert.equal(foes.length, 1, `one left alive fielded ${foes.length}`);
  assert.equal(foes[0].kind, one[0].subspecies, 'and it is the one that is left');
});

test('a place cleared out attacks nobody at all', () => {
  const emptied = populated({ populations: { town: [] } });
  assert.equal(beginEncounter(emptied).combat, null, 'something came out of an empty place');

  // And this is NOT the same as a world that holds no kinds, which still meets
  // the statblock foes it always did.
  assert.ok(beginEncounter(onFloorTwo()).combat, 'an old world lost its fights');
});

test('KILLING a floor thins it: what dies is gone from the population', () => {
  // A fight the party actually WINS, or nothing dies and this asserts nothing.
  const won = winnable();
  const start = { ...won, world: { ...won.world, seed: 11, species: speciesFor(11) } };
  const floor = start.world.regions['floor-2'].floor;
  const before = populationAt(start.world, 'floor-2', 'town', floor)!;

  const { state: fighting } = fightItOut(beginEncounter(start));
  const dead = foesOf(fighting).filter((c) => c.dead);
  assert.ok(dead.length > 0, 'nothing died, so this asserts nothing');

  const after = populationAt(concludeCombat(fighting).state.world, 'floor-2', 'town', floor)!;
  assert.equal(sizeIn(after), sizeIn(before) - dead.length, 'the dead are still in the crowd');
  for (const body of dead) {
    assert.ok(body.kind && body.trade, 'a body with no cohort cannot be taken out of one');
  }
});

test('the word and the body agree: a foe is what it is called', () => {
  const kinds = speciesFor(11);
  const floor = 4;
  // Every word the model could say for this floor, so there is one per lineage.
  const creatures = leavesUnder(kinds, packAt(11, kinds, floor)!).map((k) => `word-${k.id}`);
  const base = onFloorTwo();
  const region = { ...base.world.regions['floor-2'], floor, danger: 6, creatures };
  const start = {
    ...base,
    world: { ...base.world, seed: 11, species: kinds, regions: { 'floor-2': region } },
  };

  const foes = foesOf(beginEncounter(start));
  assert.ok(foes.length > 0);
  for (const foe of foes) {
    if (creatures.includes(foe.name)) {
      assert.equal(foe.kind, foeSpecies(start.world, foe.name, floor).id, `a ${foe.name} is not a ${foe.kind}`);
    } else {
      // A lineage no word covers wears its own name; the engine invents none.
      assert.ok(foe.name.includes(foe.kind!), `${foe.name} names neither a creature nor its own kind`);
    }
  }
});

/*
 * ANCHOR PLUS DELTA, 2026-09-13. Since 3n a crowd foe's abilities were raw
 * `scaleFoe`, so its kind's template sat on its sheet and never reached the
 * fight — while a world stored before kinds still got it through `makeFoe`. The
 * anchor keeps the curve; the kind is the delta on top of it, as it always was.
 */
test("a foe fights with its kind's template on top of the anchor", () => {
  const kinds = speciesFor(11);
  let felt = 0;
  for (const floor of [2, 5, 9, 14, 22]) {
    const base = onFloorTwo();
    const danger = Math.max(1, floor);
    const region = { ...base.world.regions['floor-2'], floor, danger, creatures: ['a', 'b', 'c'] };
    const start = { ...base, world: { ...base.world, seed: 11, species: kinds, regions: { 'floor-2': region } } };

    const roles = composition(danger, kindForFloor(floor));
    for (const [i, foe] of foesOf(beginEncounter(start)).entries()) {
      const anchor = scaleFoe(danger, roles[i]).abilities;
      const template = kinds.find((k) => k.id === foe.kind)!.template ?? {};
      if (Object.values(template).some((by) => by)) felt++;
      for (const a of ABILITIES) {
        assert.equal(foe.abilities[a], anchor[a] + (template[a] ?? 0), `floor ${floor} ${foe.kind} ${a}: the kind never reached the fight`);
      }
    }
  }
  assert.ok(felt > 0, 'no foe had a template, so this asserts nothing');
});

/*
 * THE PLAYER FIGHTS WITH WHAT THEY CARRY. Found 2026-09-13 while building the
 * harness climber for 3o: `playerCombatant` called `toCombatant` without the
 * inventory, so since 2026-09-02 no found weapon, coat, refine, enchant or
 * rarity grant had ever reached a fight — the sheet said AC 17 and the fight used
 * 11, swinging the background's 1d6 while a d12 was in hand.
 */
test('the player fights with what they are wearing and wielding', () => {
  let bag = addItem(emptyInventory(), armour(mulberry32(3), 20));
  bag = equip(bag, bag.held[0].instance.id).inventory;
  bag = addItem(bag, weapon(mulberry32(5), 25));
  bag = equip(bag, bag.held[1].instance.id).inventory;
  const base = onFloorTwo();
  const state = { ...base, pc: { ...base.pc, inventory: bag } };

  const pc = beginEncounter(state).combat!.combatants['pc'];
  assert.equal(pc.ac, armourClassFor(state.sheet, bag), 'the AC on the sheet is the AC in the fight');
  assert.deepEqual(pc.attacks, [equippedAttack(bag)], 'the blade in hand is the one it swings');
  assert.deepEqual(pc.abilities, finalAbilities(state.sheet, bag), 'with what its gear grants');
});

/*
 * 6b stage 4: the boss fight is the person the landmark floor made — built
 * through the real floor generator, not by hand.
 */
async function bossFloor(base: PlayState, danger?: number) {
  const kinds = speciesFor(11);
  const w = { ...base.world, seed: 11, species: kinds };
  const r = await generateFloor(
    new FakeProvider({ structured: [generatedFloor({ bossName: 'the Warden of Ash', bossOneLine: 'holds the tenth stair' })] }),
    w, 10, base.sheet,
  );
  const boss = r.people[r.region.boss ?? ''];
  assert.ok(boss, 'the landmark floor made a boss');
  const region = { ...r.region, ...(danger === undefined ? {} : { danger }) };
  const state: PlayState = {
    ...base,
    world: { ...w, regions: { [region.id]: region }, currentRegion: region.id, currentPlace: region.entrance, people: { ...w.people, ...r.people } },
  };
  return { state, boss, region, kinds };
}

test('the boss fight IS the person the floor made: the boss anchor plus its kind', async () => {
  const { state, boss, region, kinds } = await bossFloor(onFloorTwo());
  const foes = foesOf(beginEncounter(state));

  assert.equal(foes.length, 1, 'a boss fights alone');
  assert.equal(foes[0].person, boss.id, 'the thing you fight is the person the floor made');
  const anchor = scaleFoe(region.danger, 'boss').abilities;
  const template = kinds.find((k) => k.id === boss.sheet!.species)!.template ?? {};
  for (const a of ABILITIES) assert.equal(foes[0].abilities[a], anchor[a] + (template[a] ?? 0), `${a}`);
});

test('a boss you killed stays dead, and the next fight there is the crowd', async () => {
  const { state, boss } = await bossFloor(winnable(), 1);
  const { state: fought } = fightItOut(beginEncounter(state));
  assert.equal(fought.combat?.victor, 'party', 'the party has to win for this to say anything');

  const after = concludeCombat(fought).state;
  assert.equal(after.world.people[boss.id].alive, false, 'a boss you killed is dead');
  const next = foesOf(beginEncounter(after));
  assert.ok(next.length > 0, 'something still lives here');
  assert.ok(next.every((f) => f.person !== boss.id), 'and it is not the boss come back');
});

/*
 * 6b stage 5: a person whose grudge has gone far enough COMES FOR YOU — as far as
 * the law lets them. `crossFloors` binds residents in STANDARD, so by default a
 * grudge stays on its own floor.
 *
 * RESPECIFIED 2026-09-17 (stage 7.1b, DESIGN 6b 7.1): a grudge no longer drops its
 * bearer into your next fight. They TRAVEL, and arriving is what opens the fight.
 * So a grudge here comes with a journey that has already reached you, unless the
 * test says otherwise.
 */

/** Somebody holding a grudge against the player, living in `home` — and, unless told not to, already arrived. */
function grudge(state: PlayState, who: string, home: string, { arrived = true } = {}): PlayState {
  const here = { region: state.world.currentRegion, place: state.world.currentPlace };
  return {
    ...state,
    world: {
      ...state.world,
      people: { ...state.world.people, [who]: { ...state.world.people[who], homeRegion: home } },
      edges: nudge(state.world.edges, who, PLAYER, 'resentment', 3),
      ...(arrived ? { journeys: [...journeysOf(state.world), { who, for: who, ...here, progress: 0, departs: 0 }] } : {}),
    },
  };
}

/** A turn, played live, with this delta. */
const takeTurn = (state: PlayState, delta: WorldDelta): PlayState =>
  applyTurn(state, { ...combatTurn([]), combatActions: undefined, delta }).state;

/** Let time pass in turns of up to three ticks, stopping if a fight opens. */
function passTime(state: PlayState, ticks: number): PlayState {
  let s = state;
  for (let left = ticks; left > 0 && !s.combat; left -= Math.min(3, left)) s = takeTurn(s, { timeSpent: Math.min(3, left) });
  return s;
}

const journeyOf = (state: PlayState, who: string) => journeysOf(state.world).find((j) => j.who === who);

/**
 * Somebody with a grudge, on the road from `place` in `region` — knowing where the
 * player stands now, since 7.1c a traveller with no word of you goes nowhere.
 */
function travelling(state: PlayState, who: string, region: string, place: string | null): PlayState {
  const s = seenBy(grudge(state, who, region, { arrived: false }), who, state.world.currentPlace);
  return { ...s, world: { ...s.world, journeys: [{ who, for: who, region, place, progress: 0, departs: 0 }] } };
}

const withRules = (state: PlayState, rules: Ruleset): PlayState => ({ ...state, world: { ...state.world, rules } });

// Was: "a grudge on your floor comes for you: the next fight is them, alone".
// Respecified by 7.1b: only an ARRIVED grudge is in the fight.
test('when their journey reaches you, the fight is them, alone', () => {
  const state = grudge(populated(), 'smith', 'floor-2');
  const after = beginEncounter(state);
  const foes = foesOf(after);
  assert.equal(foes.length, 1, 'they come alone');
  assert.equal(foes[0].person, 'smith', 'the fight is the person holding the grudge');
  const sheet = after.world.people.smith.sheet;
  assert.ok(sheet, 'Person.sheet gets its other writer');

  const anchor = scaleFoe((state.world.regions['floor-2'] as Region).danger, 'elite').abilities;
  const template = speciesFor(11).find((k) => k.id === sheet.species)?.template ?? {};
  for (const a of ABILITIES) assert.equal(foes[0].abilities[a], anchor[a] + (template[a] ?? 0), `${a}`);
});

// Was: "a grudge on another floor comes only when the law lets them cross", read
// at the moment a fight opened. Respecified by 7.1b: the law is read on the ROAD —
// a journey takes a stair only where `crossFloors` lets them.
test('a journey takes a stair only where the law lets them cross', () => {
  const base = populated();
  const kinds = speciesFor(11);
  const far = travelling(
    { ...base, world: { ...base.world, regions: { ...base.world.regions, 'floor-0': groundFloor() } } },
    'smith', 'floor-0', 'town',
  );
  const smithsGroup = groupOf(kinds, speciesIdFor(11, 'smith', kinds));
  assert.ok(smithsGroup, 'the smith is a kind of thing, or the group law says nothing');
  // 60, not 30: since 7.1e-i a stair takes hours, and this crosses two.
  const smithFights = (s: PlayState) => foesOf(passTime(s, 60)).some((f) => f.person === 'smith');

  assert.equal(smithFights(far), false, 'STANDARD keeps residents on their own floor');
  assert.equal(smithFights(withRules(far, amend(STANDARD, 'crossFloors', null))), true, 'strike the law and they cross');
  assert.equal(smithFights(withRules(far, amend(STANDARD, 'crossFloors', { group: smithsGroup }))), false, 'a law on their kind holds them too');
  assert.equal(smithFights(withRules(far, amend(STANDARD, 'crossFloors', 'player'))), true, 'a law on the player does not bind them');
});

test('a person you killed does not come for you again', () => {
  const base = winnable();
  const start = grudge({ ...base, world: { ...base.world, seed: 11, species: speciesFor(11) } }, 'smith', 'floor-2');
  const opened = beginEncounter(start);
  assert.equal(foesOf(opened)[0]?.person, 'smith', 'the fight has to be against them for this to say anything');

  const { state: fought } = fightItOut(opened);
  assert.equal(fought.combat?.victor, 'party', 'the party has to win for this to say anything');
  const after = concludeCombat(fought).state;
  assert.equal(after.world.people.smith.alive, false, 'a person you killed is dead');
  const next = foesOf(beginEncounter(after));
  assert.ok(next.length > 0, 'something still lives here');
  assert.ok(next.every((f) => f.person !== 'smith'), 'and it is not them come back');
});

// Was: "... the grudge waits". Respecified by 7.1b: it is an ARRIVED grudge that waits.
test('on a landmark floor the holder fights first; an arrived grudge waits', async () => {
  const { state, boss, region } = await bossFloor(onFloorTwo());
  const foes = foesOf(beginEncounter(grudge(state, 'smith', region.id)));
  assert.equal(foes.length, 1, 'still one fight, one foe');
  assert.equal(foes[0].person, boss.id, 'and it is the holder');
});

/*
 * 6b stage 6: DEFEAT IS NOT DEATH. A character foe breaks at a line its nerve
 * moves, yields if somebody is on it and flees if not, and a yielded foe's fate
 * is the player's choice once the fight is won.
 */

test('nerve moves the break line, and a kind with no fear never breaks', () => {
  assert.equal(breakPoint(20, 0, 1), 5, 'nerve 0 breaks at a quarter');
  assert.equal(breakPoint(20, -3, 1), 10, 'a coward breaks at half');
  assert.equal(breakPoint(20, 3, 1), 0, 'a fearless thing never breaks');
  assert.equal(breakPoint(20, 0, 0), 0, 'nor does a kind with no safety need');
  for (const id of ['undead', 'construct', 'elemental']) {
    assert.equal((TYPES.find((t) => t.id === id)!.needs as { safety?: number }).safety, 0, id);
  }
});

/** A fight whose foes are on their break line, beside the player or across the arena. */
function brokenFight(where: 'beside' | 'away', howMany = 1, hp = 1): PlayState {
  const open = openFight(populated());
  const combat = open.combat!;
  const pc = combat.combatants['pc'];
  const foe = Object.values(combat.combatants).find((c) => c.side === 'foe')!;
  const board: Record<string, typeof pc> = { pc };
  for (let i = 0; i < howMany; i++) {
    const pos = where === 'beside' ? { x: pc.pos.x + 1, y: pc.pos.y + i } : { x: pc.pos.x + 6, y: pc.pos.y + i };
    const id = i === 0 ? foe.id : `${foe.id}-${i}`;
    board[id] = { ...foe, id, hp, breaksAt: 5, pos };
  }
  return takeCombatAction({ ...open, combat: { ...combat, combatants: board } }, { kind: 'end' }).state;
}

test('when the last foe yields you have won, and you still owe it a fate', () => {
  const s = brokenFight('beside');
  assert.equal(s.combat!.victor, 'party');
  assert.equal(Object.values(s.combat!.broken ?? {})[0]?.as, 'yielded');
  assert.equal(awaitingPlayer(s), true, 'the fight is not finished');
  assert.deepEqual(combatOptions(s).map((o) => o.action.kind).sort(), ['kill', 'spare']);
});

test('spare a person and they live and remember it; kill them and they are dead', () => {
  // Danger 4, not winnable()'s 1: at danger 1 the smith has 12 hit points and one
  // blow carries them from above the line straight to nothing, so they never break.
  const base = winnable();
  const deeper = { ...(base.world.regions['floor-2'] as Region), danger: 4 };
  const pre = grudge(
    { ...base, world: { ...base.world, seed: 11, species: speciesFor(11), regions: { 'floor-2': deeper } } },
    'smith', 'floor-2',
  );
  const choosing = (kind: 'spare' | 'kill') => fightItOut(openFight(pre), 200, (o) => o.find((x) => x.action.kind === kind) ?? o[0]).actions;

  const sparing = choosing('spare');
  assert.ok(sparing.some((a) => a.kind === 'spare'), 'the smith has to yield for this to say anything');
  const spared = applyTurn(pre, combatTurn(sparing)).state;
  assert.equal(spared.world.people.smith.alive, true);
  assert.ok(axisOf(spared.world.edges, 'smith', PLAYER, 'obligation') > 0, '`spared` finally has a writer');

  const killed = applyTurn(pre, combatTurn(choosing('kill'))).state;
  assert.equal(killed.world.people.smith.alive, false);
});

test('a foe that fled or was spared is not thinned from the crowd', () => {
  const here = (s: PlayState) => populationAt(s.world, 'floor-2', 'town', 2);

  const fled = brokenFight('away');
  assert.equal(Object.values(fled.combat!.broken ?? {})[0]?.as, 'fled');
  assert.deepEqual(here(concludeCombat(fled).state), here(fled));

  const yielded = brokenFight('beside');
  const foe = Object.keys(yielded.combat!.broken ?? {})[0];
  const spared = takeCombatAction(yielded, { kind: 'spare', target: foe }).state;
  assert.deepEqual(here(concludeCombat(spared).state), here(yielded));
});

test('a statblock foe carries no break line', () => {
  assert.ok(foesOf(beginEncounter(onFloorTwo())).every((f) => f.breaksAt === undefined));
});

/*
 * Approved 2026-09-16: three guards stage 6 left untested.
 */

test('killing a holder does not thin the crowd they were never part of', async () => {
  const { state, region } = await bossFloor(winnable(), 1);
  const here = (s: PlayState) => populationAt(s.world, region.id, s.world.currentPlace, region.floor);
  const after = concludeCombat(fightItOut(beginEncounter(state)).state);  // the first option kills
  assert.ok(after.killed.length > 0, 'the holder has to die for this to say anything');
  assert.ok(here(state), 'and the floor has to have a crowd to thin');
  assert.deepEqual(here(after.state), here(state));
});

test('a foe that fled pays the same XP as one that was killed', () => {
  // TWO foes: `xpForFight` pays at least one foe's worth, so a single fled foe
  // pays the same whether or not fleeing counts, and the test would say nothing.
  const fled = concludeCombat(brokenFight('away', 2));
  let yielded = brokenFight('beside', 2);
  for (const target of Object.keys(yielded.combat!.broken!)) yielded = takeCombatAction(yielded, { kind: 'kill', target }).state;
  const killed = concludeCombat(yielded);
  assert.equal(killed.killed.length, 2, 'both have to be killed for this to say anything');
  assert.ok(fled.xp > 0, 'a win has to pay for this to say anything');
  assert.equal(fled.xp, killed.xp);
});

test('a person spared where they do not live still feels it', () => {
  const base = winnable();
  const deeper = { ...(base.world.regions['floor-2'] as Region), danger: 4 };
  const elsewhere = { ...deeper, places: deeper.places.map((p) => ({ ...p, people: p.people.filter((id) => id !== 'smith') })) };
  const pre = grudge(
    { ...base, world: { ...base.world, seed: 11, species: speciesFor(11), regions: { 'floor-2': elsewhere } } },
    'smith', 'floor-2',
  );
  const sparing = fightItOut(openFight(pre), 200, (o) => o.find((x) => x.action.kind === 'spare') ?? o[0]).actions;
  assert.ok(sparing.some((a) => a.kind === 'spare'), 'the smith has to yield for this to say anything');

  const spared = applyTurn(pre, combatTurn(sparing)).state;
  assert.ok(axisOf(spared.world.edges, 'smith', PLAYER, 'obligation') > 0);
});

/*
 * 6b stage 7: SURVIVORS WITH A FUTURE. A foe that fled badly beaten, or was
 * spared, becomes somebody. One that fled with a grudge comes back, which is how
 * a crowd foe grows into a notable.
 */

/** Who exists after that did not before. */
const newPeople = (before: PlayState, after: PlayState): string[] =>
  Object.keys(after.world.people).filter((id) => !before.world.people[id]);

/** Who lives at a place in the current region. */
const peopleAt = (state: PlayState, place: string): string[] =>
  (state.world.regions[state.world.currentRegion] as Region).places.find((p) => p.id === place)?.people ?? [];

test('a foe that fled badly beaten is somebody now, and holds a grudge', () => {
  const fled = brokenFight('away', 1, 1);
  const after = concludeCombat(fled).state;
  const [who] = newPeople(fled, after);
  assert.ok(who, 'a survivor with a future becomes a person');
  assert.equal(after.world.people[who].homeRegion, 'floor-2');
  assert.ok(peopleAt(after, 'town').includes(who), 'and lives where it broke');
  assert.ok(after.world.people[who].sheet, 'with a sheet to come back with');
  assert.equal(axisOf(after.world.edges, who, PLAYER, 'resentment'), 3);
});

test('a foe that fled lightly goes back to the crowd', () => {
  const fled = brokenFight('away', 1, 3);  // 3 is above half its line of 5
  assert.deepEqual(newPeople(fled, concludeCombat(fled).state), []);
});

test('a spared crowd foe is somebody, and the deed is toward them', () => {
  const yielded = brokenFight('beside');
  const target = Object.keys(yielded.combat!.broken!)[0];
  const out = concludeCombat(takeCombatAction(yielded, { kind: 'spare', target }).state);
  const [who] = newPeople(yielded, out.state);
  assert.ok(who);
  assert.equal(out.spared[0].person, who, 'so `spared` lands on them');
});

// Was: the survivor was simply in the next fight. Respecified by 7.1b: they SET
// OUT, recover first, and the fight opens when they arrive.
test('a survivor with a grudge comes back: a crowd foe grown into a notable', () => {
  const fled = brokenFight('away', 1, 1);
  const out = concludeCombat(fled);
  const [who] = newPeople(fled, out.state);
  assert.ok(who, 'there has to be a survivor for this to say anything');
  assert.deepEqual(out.fled, [who]);

  // They saw you where they broke (in play, the turn's sightings give them that).
  const seen = seenBy(out.state, who, out.state.world.currentPlace);
  const after = { ...seen, world: setOut(fled.world, seen.world, out.fled) };
  assert.ok(journeyOf(after, who), 'the grudge sets out');
  assert.equal(foesOf(passTime(after, RECOVERY - 1)).length, 0, 'but not before they have recovered');
  const foes = foesOf(passTime(after, RECOVERY + 3));
  assert.equal(foes.length, 1);
  assert.equal(foes[0].person, who);
});

/*
 * 6b stage 7.1b: JOURNEYS. A grudge sets out, travels on the clock, and arriving
 * is what opens the fight.
 */

test('a grudge that has not reached you is not in your fight', () => {
  const s = grudge(populated(), 'smith', 'floor-2', { arrived: false });
  assert.ok(foesOf(beginEncounter(s)).every((f) => f.person !== 'smith'));
});

test('a grudge sets out on the turn it is fed, once', () => {
  const humiliate: WorldDelta = { deed: { kind: 'humiliated', toward: 'smith' } };
  const s = takeTurn(populated(), humiliate);
  assert.equal(journeysOf(s.world).filter((j) => j.for === 'smith').length, 1);
  const again = takeTurn({ ...s, combat: null }, humiliate);
  assert.equal(journeysOf(again.world).filter((j) => j.for === 'smith').length, 1, 'never a second party');
});

test('a journey moves along links on the clock, and arrives when the time is spent', () => {
  const base = populated();
  const s = travelling({ ...base, world: { ...base.world, currentPlace: 'well' } }, 'smith', 'floor-2', 'market');
  const toTown = linkCost(s.world, 'market', 'town');
  const toWell = linkCost(s.world, 'town', 'well');

  const halfway = passTime(s, toTown);
  assert.equal(journeyOf(halfway, 'smith')?.place, 'town');
  assert.equal(halfway.combat, null);
  const there = passTime(halfway, toWell);
  assert.equal(foesOf(there)[0]?.person, 'smith', 'arriving opens the fight');
});

test('an arrival-opened fight replays from the log', () => {
  const start = grudge(winnableWithKinds(), 'smith', 'floor-2');
  const draft: TurnRecord = { ...combatTurn([]), combatActions: undefined, delta: {} };
  const { actions } = fightItOut(applyTurn(start, draft).state);
  assert.ok(actions.length > 0, 'a fight has to have opened for this to say anything');
  const live = settleFight({ pre: start, draft, actions });
  assert.deepEqual(live.state, foldPlay(start, [live.record]));
});

test('where fighting is refused they wait at the gate, and strike once you are somewhere it is not', () => {
  const base = populated();
  const town = { ...base, world: { ...base.world, regions: { ...base.world.regions, 'floor-0': groundFloor() }, currentRegion: 'floor-0' } };
  const s = withRules(travelling(town, 'smith', 'floor-0', 'gate'), amend(STANDARD, 'crossFloors', null));
  const waited = passTime(s, 9);
  assert.equal(waited.combat, null, 'no fight in town');
  assert.equal(journeyOf(waited, 'smith')?.place, 'gate', 'and they go no further than the gate');

  // Since 7.1c they follow only on word of you; here they hear at once.
  const out = seenBy({ ...waited, world: { ...waited.world, currentRegion: 'floor-2' } }, 'smith', 'town');
  // 60, not 30: since 7.1e-i each stair takes hours, and they cross two.
  assert.equal(foesOf(passTime(out, 60))[0]?.person, 'smith');
});

/*
 * 6b stage 7.1c: SIGHTINGS. Whoever is where you are sees you. Word passes a hop
 * a turn along people's edges, and a journey heads for the newest word of you —
 * not for where you really are.
 */

const sawYouAt = (state: PlayState, who: string, place: string): boolean =>
  newestSighting(state.world.people[who]?.beliefs ?? [], PLAYER)?.place === place;

/** `who` holds a firsthand sighting of the player at `place` in the current region, `later` ticks from now. */
function seenBy(state: PlayState, who: string, place: string, later = 0): PlayState {
  const claim = sightingClaim(PLAYER, state.world.currentRegion, place, clockOf(state.world) + later);
  const person = state.world.people[who];
  return {
    ...state,
    world: { ...state.world, people: { ...state.world.people, [who]: { ...person, beliefs: hearOf(person.beliefs ?? [], firsthand(claim)) } } },
  };
}

test('whoever is where you are sees you, firsthand', () => {
  const s = takeTurn(playState(), { moveTo: 'market' });
  assert.ok(sawYouAt(s, 'smith', 'market'), 'the smith lives at the market');
});

test("a sighting passes one hop per turn along people's edges", () => {
  const base = playState();
  const quiet = { ...base, world: { ...base.world, currentPlace: 'gate', edges: nudge(base.world.edges, 'warden', 'smith', 'familiarity', 1) } };
  const s = seenBy(quiet, 'smith', 'market');
  assert.equal(sawYouAt(s, 'warden', 'market'), false);
  assert.equal(sawYouAt(takeTurn(s, {}), 'warden', 'market'), true);
});

test('a journey heads for the newest sighting, not for where you are', () => {
  const base = populated();
  const atTheGate = { ...base, world: { ...base.world, currentPlace: 'gate' } };
  const s = seenBy(travelling(atTheGate, 'smith', 'floor-2', 'market'), 'smith', 'well', 1);
  assert.equal(journeyOf(passTime(s, 9), 'smith')?.place, 'well');
});

test('where nobody connected to them sees you, you are lost to them', () => {
  const base = populated();
  const atTheGate = { ...base, world: { ...base.world, currentPlace: 'gate' } };
  const s = passTime(seenBy(travelling(atTheGate, 'smith', 'floor-2', 'market'), 'smith', 'well', 1), 20);
  assert.equal(s.combat, null);
  assert.equal(journeyOf(s, 'smith')?.place, 'well', 'still at the last place they heard of you');
});

test('with no word of you at all, a grudge does not set out', () => {
  const before = populated();
  const after = grudge(before, 'smith', 'floor-2', { arrived: false });
  assert.deepEqual(journeysOf(setOut(before.world, after.world, [])), []);
  assert.equal(journeysOf(setOut(before.world, seenBy(after, 'smith', 'town').world, [])).length, 1, 'and does once they know');
});

/*
 * 6b stage 7.1d: SEND THEIR PEOPLE, CALL IN A DEBT. What a grudge can do depends
 * on who holds it — their station, their nerve, how safe they feel.
 */

/** A lord who commands a guard, a lender a debtor owes, a survivor, a nobody and an outcast. */
function stations(): PlayState {
  const base = populated();
  const roles = [
    { id: 'rule', kind: 'power' as const, names: ['lord', 'guard'] as [string, string] },
    { id: 'loan', kind: 'exchange' as const, names: ['lender', 'debtor'] as [string, string] },
  ];
  const trade = (id: string) => ({ ...base.sheet, background: { ...base.sheet.background, id } });
  const somebody = (id: string, over: Partial<Person> = {}): Person => ({ ...base.world.people.smith, id, name: id, ...over });
  const people = {
    ...base.world.people,
    lord: somebody('lord', { status: 'superior' }),
    guard: somebody('guard', { sheet: trade('watcher') }),
    lender: somebody('lender'),
    debtor: somebody('debtor'),
    survivor: somebody('survivor', { sheet: trade('hunter') }),
    nobody: somebody('nobody'),
    outcast: somebody('outcast', { status: 'inferior' }),
  };
  let edges = formRole(base.world.edges, roles, 'lord', 'guard', 'rule/a');
  edges = formRole(edges, roles, 'lender', 'debtor', 'loan/a');
  return { ...base, world: { ...base.world, roles, people, edges } };
}

/** `who` turns hostile this turn, knowing where the player is, with this nerve and sense of safety. */
function grudgeOf(who: string, { nerve = 0, safety = NEED_MAX, from = stations() } = {}): PlayState {
  const hostile = seenBy(grudge(from, who, 'floor-2', { arrived: false }), who, 'town');
  const person = hostile.world.people[who];
  const shaken = {
    ...person,
    temperament: { ...person.temperament, nerve: nerve * 3 },
    needs: { ...person.needs, safety },
  };
  const after = { ...hostile.world, people: { ...hostile.world.people, [who]: shaken } };
  return { ...hostile, world: setOut(from.world, after, []) };
}

test('station is derived from roles, trade and status', () => {
  const w = stations().world;
  assert.equal(stationOf(w, 'lord'), 'noble', 'commands someone, and superior');
  assert.equal(stationOf(w, 'lender'), 'merchant', 'owed coin');
  assert.equal(stationOf(w, 'guard'), 'guard', 'a watcher by trade');
  assert.equal(stationOf(w, 'survivor'), 'adventurer', 'a hunter by trade');
  assert.equal(stationOf(w, 'nobody'), 'villager');
  assert.equal(stationOf(w, 'outcast'), 'beggar', 'inferior, and bound to nobody');
});

test('a noble with somebody to command sends them, and stays home', () => {
  const s = grudgeOf('lord');
  assert.equal(journeyOf(s, 'guard')?.for, 'lord');
  assert.equal(journeyOf(s, 'lord'), undefined);
});

test("the one sent fights on the bearer's grudge", () => {
  const s = grudgeOf('lord');
  const here = { region: s.world.currentRegion, place: s.world.currentPlace };
  const arrived = { ...s, world: { ...s.world, journeys: journeysOf(s.world).map((j) => ({ ...j, ...here })) } };
  assert.equal(foesOf(beginEncounter(arrived))[0]?.person, 'guard');
});

test('whoever owes them can be called in', () => {
  assert.equal(journeyOf(grudgeOf('lender'), 'debtor')?.for, 'lender');
});

test('an adventurer only ever comes themselves', () => {
  const base = stations();
  const withServant = { ...base, world: { ...base.world, edges: formRole(base.world.edges, base.world.roles!, 'survivor', 'nobody', 'rule/a') } };
  assert.equal(journeyOf(grudgeOf('survivor', { from: withServant }), 'survivor')?.for, 'survivor');
});

test('nerve decides between coming and sending', () => {
  assert.equal(journeyOf(grudgeOf('lord', { nerve: 3 }), 'lord')?.for, 'lord');
  assert.equal(journeyOf(grudgeOf('lord', { nerve: -3 }), 'guard')?.for, 'lord');
});

test('someone afraid for their safety sends rather than comes', () => {
  assert.equal(journeyOf(grudgeOf('lord', { nerve: 3, safety: 1 }), 'guard')?.for, 'lord');
});

/*
 * 6b stage 7.1e-iii: DAY AND NIGHT. Night is 20:00–06:00. At night only guards
 * and night kinds are out: they are who can see you, or be met. The Director is
 * told the hour, the dark and the season; a hunter fights at night with an edge.
 */

const atClock = (state: PlayState, clock: number): PlayState => ({ ...state, world: { ...state.world, clock } });

/** The state at this hour of the world's first day (the clock starts at 08:00). */
const atHour = (state: PlayState, hour: number, minute = 0): PlayState =>
  atClock(state, (((hour * 60 + minute) / 10 - 8 * 6) % 144 + 144) % 144);

/** A leaf whose group keeps night hours, in world 11. */
function nightKind(): string {
  const kinds = speciesFor(11);
  const leaf = kinds.find((k) => k.level === 'subspecies' && habitOf(11, groupOf(kinds, k.id)!).nocturnal);
  assert.ok(leaf, 'world 11 has no night kind — the test says nothing');
  return leaf.id;
}

test('night is 20:00 to 06:00', () => {
  const w = populated();
  assert.equal(isNight(atHour(w, 19, 50).world), false);
  assert.equal(isNight(atHour(w, 20, 0).world), true);
  assert.equal(isNight(atHour(w, 5, 50).world), true);
  assert.equal(isNight(atHour(w, 6, 0).world), false);
});

test('at night only guards and night kinds are out to see you', () => {
  const base = stations();
  const market = (base.world.regions['floor-2'] as Region);
  const places = market.places.map((p) => (p.id === 'market' ? { ...p, people: ['smith', 'guard', 'owl'] } : p));
  const owl = { ...base.world.people.smith, id: 'owl', name: 'owl', species: nightKind() };
  const s = atHour({
    ...base,
    world: { ...base.world, currentPlace: 'market', people: { ...base.world.people, owl }, regions: { 'floor-2': { ...market, places } } },
  }, 22);
  const after = takeTurn(s, {});
  assert.ok(sawYouAt(after, 'guard', 'market'), 'a guard is on watch');
  assert.ok(sawYouAt(after, 'owl', 'market'), 'a night kind is about');
  assert.equal(sawYouAt(after, 'smith', 'market'), false, 'the smith is indoors');
});

test('the Director is told the hour, whether it is dark, and the season', async () => {
  const s = atHour(populated(), 22, 10);
  const p = new FakeProvider({ structured: [] });
  await runDirector(p, s, 'look around', 'exploration', []).catch(() => {});
  assert.match(p.allSentText(), /22:10/);
  assert.match(p.allSentText(), /dark/);
  assert.ok(p.allSentText().includes(calendarWords(s.world).seasons[dateOf(s.world).season]));
});

test('a hunter by trade fights with an edge at night', () => {
  const base = stations();
  const hunter = { ...base, world: { ...base.world, people: { ...base.world.people, smith: { ...base.world.people.smith, sheet: base.world.people.survivor.sheet } } } };
  const armed = (s: PlayState) => foesOf(beginEncounter(grudge(s, 'smith', 'floor-2')))[0];
  assert.equal(armed(atHour(hunter, 23))?.nightEyed, true);
  assert.equal(armed(atHour(hunter, 12))?.nightEyed, undefined);
});

/*
 * 6b stage 7.1e-iv: NEEDS DRAIN BY THE HOURS. Food drops a point every 4 hours,
 * rest every 2 waking hours, counted on whole hours of the clock — not by turns.
 */
test('needs drain by hours passed, not by turns', () => {
  const awake = atClock(playState(), 0);
  const six = passTime(awake, 36);                           // six hours of talking
  assert.equal(six.sheet.needs.food, NEED_MAX - 1, 'a point of food every four hours');
  assert.equal(six.sheet.needs.rest, NEED_MAX - 3, 'a point of rest every two waking hours');
  assert.deepEqual(passTime(awake, 1).sheet.needs, awake.sheet.needs, 'ten minutes costs nothing');
});

/*
 * 6b stage 7.1e-v: SEASONS. In winter a wild link takes half as long again, the
 * cold outside a settlement drains food and rest half as fast again, and a group
 * that keeps to some seasons is not out in the others.
 */

/** The same state, on the first day of the year on which it is `season`. */
function inSeason(state: PlayState, season: number): PlayState {
  for (let day = 0; day < 360; day++) {
    const s = atClock(state, day * 144);
    if (dateOf(s.world).season === season) return s;
  }
  throw new Error(`no day of the year is season ${season}`);
}
const WINTER = 3;
const SUMMER = 1;

/** The ground floor, with its well made wild. */
function wildWell(): PlayState {
  const base = playState();
  const ground = base.world.regions['floor-0'] as Region;
  const places = ground.places.map((p) => (p.id === 'well' ? { ...p, kind: 'wild' as const } : p));
  return { ...base, world: { ...base.world, regions: { 'floor-0': { ...ground, places } } } };
}

test('in winter a wild link takes half as long again, a tame one does not', () => {
  const winter = inSeason(wildWell(), WINTER);
  const summer = inSeason(wildWell(), SUMMER);
  assert.equal(travelTime(winter.world, 'town', 'well'), Math.ceil(1.5 * linkCost(winter.world, 'town', 'well')));
  assert.equal(travelTime(summer.world, 'town', 'well'), linkCost(summer.world, 'town', 'well'));
  assert.equal(travelTime(winter.world, 'town', 'market'), linkCost(winter.world, 'town', 'market'), 'no end of it is wild');
});

test('in winter, outside a settlement, food and rest drain half as fast again', () => {
  const at = (season: number, place: string) => {
    const s = inSeason(wildWell(), season);
    return passTime({ ...s, world: { ...s.world, currentPlace: place } }, 72).sheet.needs;
  };
  assert.ok(at(WINTER, 'well').food < at(SUMMER, 'well').food, 'the cold makes you hungry');
  assert.ok(at(WINTER, 'well').rest < at(SUMMER, 'well').rest, 'and tired');
  assert.deepEqual(at(WINTER, 'town'), at(SUMMER, 'town'), 'not under a roof');
});

test('about one group in six is a night kind, and one in six keeps to some seasons', () => {
  const habits = Array.from({ length: 60 }, (_, seed) =>
    speciesFor(seed).filter((k) => k.level === 'group').map((g) => habitOf(seed, g.id))).flat();
  const share = (f: (h: { nocturnal: boolean; seasons: number[] }) => boolean) => habits.filter(f).length / habits.length;
  assert.ok(Math.abs(share((h) => h.nocturnal) - 1 / 6) < 0.05, `night kinds ${share((h) => h.nocturnal)}`);
  assert.ok(Math.abs(share((h) => h.seasons.length < 4) - 1 / 6) < 0.05, `seasonal ${share((h) => h.seasons.length < 4)}`);
});

test('a group out of season fields nobody', () => {
  const base = populated();
  const floor = (base.world.regions['floor-2'] as Region).floor;
  const kinds = speciesFor(11);
  const seasonal = (populationAt(base.world, 'floor-2', 'town', floor) ?? [])
    .map((c) => groupOf(kinds, c.subspecies)!)
    .find((g) => habitOf(11, g).seasons.length < 4);
  assert.ok(seasonal, 'no group in this crowd keeps to some seasons — the test says nothing');
  const off = [0, 1, 2, 3].find((s) => !habitOf(11, seasonal).seasons.includes(s))!;
  const foes = foesOf(beginEncounter(inSeason(base, off)));
  assert.ok(foes.every((f) => f.group !== seasonal), 'nobody of a group that is away this season');
});

/*
 * 6b stage 7.1f: GRUDGES FADE, over real days. Each grudge remembers when it was
 * last fed and loses a point per N days unfed, N by the bearer's temper (1–5),
 * doubled if they owe the player. A chase goes on at 2; setting out needs 3.
 */

const resentmentOf = (state: PlayState, who: string) => axisOf(state.world.edges, who, PLAYER, 'resentment');
const fedAtOf = (state: PlayState, who: string) => state.world.edges?.[`${who}>${PLAYER}`]?.fedAt;
const humiliate = (who: string): WorldDelta => ({ deed: { kind: 'humiliated', toward: who } });

/** `who` holds a grudge fed at tick `at`, and the clock reads `at`. */
function fed(state: PlayState, who: string, at: number): PlayState {
  const g = atClock(grudge(state, who, 'floor-2', { arrived: false }), at);
  const key = `${who}>${PLAYER}`;
  return { ...g, world: { ...g.world, edges: { ...g.world.edges, [key]: { ...g.world.edges![key], fedAt: at } } } };
}

function withResentment(state: PlayState, who: string, level: number): PlayState {
  const key = `${who}>${PLAYER}`;
  const edge = state.world.edges![key];
  return { ...state, world: { ...state.world, edges: { ...state.world.edges, [key]: { ...edge, axes: { ...edge.axes, resentment: level } } } } };
}

/** A persona with this warmth and discipline, as `dispositionOf` reads them. */
const temper = ({ warmth = 0, discipline = 0 }: { warmth?: number; discipline?: number }) => {
  const p = playState().world.people.smith;
  return { ...p, temperament: { ...p.temperament, feeling: warmth * 3, discipline: discipline * 3 } };
};

test('a grudge remembers when it was fed', () => {
  // Fed once at 50, so only being fed AGAIN can move the timer to now.
  const s = takeTurn(atClock(fed(populated(), 'smith', 50), 100), humiliate('smith'));
  assert.equal(fedAtOf(s, 'smith'), clockOf(s.world));
});

test("a grudge loses a point after its bearer's days, counted from when it was fed", () => {
  const s = fed(populated(), 'smith', 100);                  // a neutral temper: three days
  assert.equal(resentmentOf(passTime(s, 3 * TICKS_PER_DAY - 1), 'smith'), 3);
  assert.equal(resentmentOf(passTime(s, 3 * TICKS_PER_DAY), 'smith'), 2);
});

test('the coldest, most disciplined hold a grudge five days; the warmest, most impulsive one', () => {
  assert.equal(fadeDays(temper({ warmth: -3, discipline: 3 })), 5);
  assert.equal(fadeDays(temper({ warmth: 3, discipline: -3 })), 1);
  assert.equal(fadeDays(temper({})), 3);
});

test('owing you doubles how long it holds', () => {
  const s = fed(populated(), 'smith', 0);
  const owing = { ...s, world: { ...s.world, edges: nudge(s.world.edges, 'smith', PLAYER, 'obligation', 2) } };
  assert.equal(resentmentOf(passTime(owing, 3 * TICKS_PER_DAY), 'smith'), 3);
  assert.equal(resentmentOf(passTime(owing, 6 * TICKS_PER_DAY), 'smith'), 2);
});

test('a grudge fed this turn does not fade this turn', () => {
  const s = atClock(fed(populated(), 'smith', 0), 3 * TICKS_PER_DAY - 1);
  const again = takeTurn(s, { ...humiliate('smith'), timeSpent: 3 });
  assert.equal(resentmentOf(again, 'smith'), 4, 'crossing its third day while being fed takes nothing');
  assert.equal(fedAtOf(again, 'smith'), clockOf(again.world));
});

test('a chase goes on at 2 and turns back below it; setting out still needs 3', () => {
  const base = populated();
  const far = { ...base, world: { ...base.world, currentPlace: 'well' } };
  const onTheRoad = travelling(far, 'smith', 'floor-2', 'market');
  assert.ok(journeyOf(takeTurn(withResentment(onTheRoad, 'smith', 2), {}), 'smith'), 'at 2 they keep coming');
  assert.equal(journeyOf(takeTurn(withResentment(onTheRoad, 'smith', 1), {}), 'smith'), undefined, 'at 1 they turn back');

  const two = withResentment(seenBy(grudge(base, 'smith', 'floor-2', { arrived: false }), 'smith', 'town'), 'smith', 2);
  assert.deepEqual(journeysOf(setOut(base.world, two.world, [])), [], 'a grudge of 2 does not set out');
});

test('an arrived traveller fights on a grudge of 2', () => {
  const s = withResentment(grudge(populated(), 'smith', 'floor-2'), 'smith', 2);
  assert.equal(foesOf(beginEncounter(s))[0]?.person, 'smith');
});

test('a survivor recovers for a day', () => {
  assert.equal(RECOVERY, TICKS_PER_DAY);
});

/*
 * 6b stage 7.1e, follow-up (2026-09-18): a floor whose only group is away this
 * season is filled by another group that lives at its depth — and stands empty
 * only where the law allows it.
 */

/** A world and a floor whose pack keeps to some seasons, in one of its off seasons, with company at its depth. */
function floorWhoseGroupIsAway() {
  for (let seed = 0; seed < 60; seed++) {
    const kinds = speciesFor(seed);
    for (let floor = 1; floor <= 20; floor++) {
      if (floor % 10 === 0) continue;                         // a landmark fights its holder, not its crowd
      const away = packAt(seed, kinds, floor);
      if (!away) continue;
      const habit = habitOf(seed, away);
      if (habit.seasons.length === 4) continue;
      const off = [0, 1, 2, 3].find((s) => !habit.seasons.includes(s))!;
      const company = groupsAt(seed, kinds, floor)
        .filter((g) => g.id !== away && habitOf(seed, g.id).seasons.includes(off));
      if (company.length === 0) continue;
      const base = populated();
      const region = { ...(base.world.regions['floor-2'] as Region), floor };
      const state = inSeason({ ...base, world: { ...base.world, seed, species: kinds, regions: { 'floor-2': region } } }, off);
      return { state, away, floor, seed, kinds };
    }
  }
  throw new Error('no world has a seasonal pack with company at its depth — the tests say nothing');
}

test("a floor whose only group is away this season is filled by another that lives at its depth", () => {
  const { state, away, floor, seed, kinds } = floorWhoseGroupIsAway();
  const foes = foesOf(beginEncounter(state));
  assert.ok(foes.length > 0, 'somebody is out');
  assert.ok(foes.every((f) => f.group !== away && livesAt(seed, kinds, f.group!, floor)), JSON.stringify(foes.map((f) => f.group)));
});

test('where the law allows it, such a floor stands empty', () => {
  const { state } = floorWhoseGroupIsAway();
  const lawful = withRules(state, { ...STANDARD, world: { ...STANDARD.world, emptyOutOfSeason: true } });
  assert.equal(beginEncounter(lawful).combat, null);
});

/*
 * 6b stage 8a: PARLEY. A word in the middle of a fight, whose verdict the action
 * carries — so the fold never asks the model, and a replay hears the same answer.
 */

const parley = (target: string, verdict: ParleyEffect): CombatAction =>
  ({ kind: 'parley', target, say: '', roll: null, verdict });

const talks = (s: PlayState) => combatOptions(s).filter((o) => o.action.kind === 'parley');

/** An open fight with exactly one foe standing, beside the player and well above its break line. */
function oneFoe(): PlayState {
  const open = openFight(populated());
  const combat = open.combat!;
  const pc = combat.combatants['pc'];
  const foe = foesOf(open)[0];
  // Seed 11's floor fields undead, which cannot be talked to; this one is of a kind that can.
  const listener = (open.world.species ?? []).find((k) => k.level === 'subspecies' && needScale(k, 'company') > 0)!;
  const board = { pc, [foe.id]: { ...foe, kind: listener.id, hp: 40, maxHp: 40, breaksAt: 5, pos: { x: pc.pos.x + 1, y: pc.pos.y } } };
  return { ...open, combat: { ...combat, combatants: board } };
}

test('a kind with no company need cannot be talked to', () => {
  const s = oneFoe();
  const foe = foesOf(s)[0];
  const undying = (s.world.species ?? []).find((k) => k.level === 'subspecies' && needScale(k, 'company') === 0)!;
  const deaf = { ...s, combat: { ...s.combat!, combatants: { ...s.combat!.combatants, [foe.id]: { ...foe, kind: undying.id } } } };
  assert.ok(talks(s).length > 0, 'an ordinary foe can be');
  assert.equal(talks(deaf).length, 0);
});

test('every foe still standing is one option, and a broken one is none', () => {
  const s = brokenFight('away', 1, 1);
  const open = takeCombatAction(oneFoe(), { kind: 'end' }).state;   // for contrast: nobody broken
  assert.deepEqual(talks(open).map((o) => (o.action as { target: string }).target), foesOf(open).map((f) => f.id));
  assert.equal(talks(s).length, 0, 'the only foe fled, and the fight is over');
});

test('a foe hears you once', () => {
  const s = oneFoe();
  assert.equal(talks(s).length, 1, 'it could be spoken to before');
  const said = takeCombatAction(s, parley(foesOf(s)[0].id, 'refuses')).state;
  assert.equal(said.combat!.over, false);
  assert.equal(talks(said).length, 0);
});

test('talked into yielding is off the board, the fight is won, and it is owed a fate', () => {
  const s = oneFoe();
  const foe = foesOf(s)[0].id;
  const after = takeCombatAction(s, parley(foe, 'yields')).state;
  assert.equal(after.combat!.broken![foe]?.as, 'yielded');
  assert.equal(after.combat!.combatants[foe], undefined);
  assert.equal(after.combat!.victor, 'party');
  assert.deepEqual(combatOptions(after).map((o) => o.action.kind).sort(), ['kill', 'spare']);
});

test('one talked into leaving goes without a grudge', () => {
  // The smith comes on a grudge of 3; leaving on words must not add stage 7's beating.
  const base = winnable();
  const deeper = { ...(base.world.regions['floor-2'] as Region), danger: 4 };
  const pre = grudge(
    { ...base, world: { ...base.world, seed: 11, species: speciesFor(11), regions: { 'floor-2': deeper } } },
    'smith', 'floor-2',
  );
  const open = openFight(pre);
  const smith = foesOf(open).find((f) => f.person === 'smith')!;
  assert.ok(smith, 'the smith has to be in the fight');
  assert.equal(takeCombatAction(open, parley(smith.id, 'withdraws')).state.combat!.broken?.[smith.id]?.as, 'fled');
  const before = axisOf(pre.world.edges, 'smith', PLAYER, 'resentment');
  const after = applyTurn(pre, combatTurn([parley(smith.id, 'withdraws')])).state;
  assert.equal(after.world.people.smith.alive, true);
  assert.equal(axisOf(after.world.edges, 'smith', PLAYER, 'resentment'), before, 'words are not a beating');
});

test('a refusal changes the board not at all, and costs the turn like any other action', () => {
  const s = oneFoe();
  const refused = takeCombatAction(s, parley(foesOf(s)[0].id, 'refuses')).state;
  const ended = takeCombatAction(s, { kind: 'end' }).state;
  assert.deepEqual(Object.keys(refused.combat!.combatants), Object.keys(s.combat!.combatants));
  assert.equal(refused.combat!.round, ended.combat!.round);
});

test('a foe talked out of the fight is worth what one that broke is worth', () => {
  const s = oneFoe();
  const foe = foesOf(s)[0].id;
  const won = takeCombatAction(takeCombatAction(s, parley(foe, 'yields')).state, { kind: 'spare', target: foe }).state;
  const floor = s.world.regions['floor-2'].floor;
  assert.equal(concludeCombat(won).xp, xpForFight(floor, s.sheet.level, 1));
});

test('a parley replays from the record without asking the model again', () => {
  // Seed 5 fields a kind that listens; seed 11's undead would refuse the word outright.
  const pre = winnable({ world: { ...winnable().world, seed: 5, species: speciesFor(5) } });
  const draft: TurnRecord = { ...combatTurn([]), combatActions: undefined };
  const opened = applyTurn(pre, draft).state;
  const first = foesOf(opened)[0].id;
  const said = takeCombatAction(opened, parley(first, 'refuses'));
  assert.equal(said.error, null, 'the parley has to be heard for the replay to say anything');
  const { actions } = fightItOut(said.state);
  const live = settleFight({ pre, draft, actions: [parley(first, 'refuses'), ...actions] });
  assert.deepEqual(live.state, foldPlay(pre, [live.record]));
});

test('the fight log says what happened, not what the model wrote', () => {
  const s = oneFoe();
  const foe = foesOf(s)[0].id;
  const step = takeCombatAction(s, parley(foe, 'refuses'));
  assert.deepEqual(notableEvents(step.events).slice(0, 1), [`${foe} will not hear it`]);
});

test('an effect outside the vocabulary is a refusal', async () => {
  const s = oneFoe();
  const said = { ability: 'cha', onHit: { effect: 'joins' }, onPartial: { effect: 'withdraws' }, onMiss: { effect: 'refuses' } };
  const out = await runParley(new FakeProvider({ structured: [said] }), s, foesOf(s)[0], 'put it down');
  assert.equal(out.onHit, 'refuses');
  assert.equal(out.onPartial, 'withdraws', 'and one it knows passes through');
});
