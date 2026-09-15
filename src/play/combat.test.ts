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
import { bandOf, livesAt, packAt } from '../character/habitat.ts';
import { populationAt, sizeIn } from '../character/population.ts';
import { groupOf, leavesUnder } from '../character/species.ts';
import { preyOf } from '../character/prey.ts';
import type { CombatAction, CombatOption } from './combat.ts';
import { applyDelta, applyTurn, foldPlay, settleFight, validateDelta } from './delta.ts';
import { xpToNext } from './progress.ts';
import { COUNTERS } from './traits.ts';
import { counterOf } from '../character/persona.ts';
import { believes } from '../character/belief.ts';
import { axisOf, nudge, PLAYER } from '../social/edge.ts';
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
 */

/** Somebody holding a grudge against the player, living in `home`. */
function grudge(state: PlayState, who: string, home: string): PlayState {
  return {
    ...state,
    world: {
      ...state.world,
      people: { ...state.world.people, [who]: { ...state.world.people[who], homeRegion: home } },
      edges: nudge(state.world.edges, who, PLAYER, 'resentment', 3),
    },
  };
}

const withRules = (state: PlayState, rules: Ruleset): PlayState => ({ ...state, world: { ...state.world, rules } });

test('a grudge on your floor comes for you: the next fight is them, alone', () => {
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

test('a grudge on another floor comes only when the law lets them cross', () => {
  const base = populated();
  const kinds = speciesFor(11);
  const far = grudge(
    { ...base, world: { ...base.world, regions: { ...base.world.regions, 'floor-0': groundFloor() } } },
    'smith', 'floor-0',
  );
  const smithsGroup = groupOf(kinds, speciesIdFor(11, 'smith', kinds));
  assert.ok(smithsGroup, 'the smith is a kind of thing, or the group law says nothing');
  const smithFights = (s: PlayState) => foesOf(beginEncounter(s)).some((f) => f.person === 'smith');

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

test('on a landmark floor the holder fights first; the grudge waits', async () => {
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

/** A fight whose one foe is on its break line, beside the player or across the arena. */
function brokenFight(where: 'beside' | 'away'): PlayState {
  const open = openFight(populated());
  const combat = open.combat!;
  const pc = combat.combatants['pc'];
  const foe = Object.values(combat.combatants).find((c) => c.side === 'foe')!;
  const pos = where === 'beside' ? { x: pc.pos.x + 1, y: pc.pos.y } : { x: pc.pos.x + 6, y: pc.pos.y };
  const board = { pc, [foe.id]: { ...foe, hp: 1, breaksAt: 5, pos } };
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
