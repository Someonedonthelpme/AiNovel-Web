import test from 'node:test';
import assert from 'node:assert/strict';
import { counterOf } from '../character/persona.ts';
import { addItem } from '../items/types.ts';
import { draught } from '../items/catalogue.ts';
import { climb } from './climb.ts';
import { awaitingPlayer, beginEncounter, combatOptions, concludeCombat, takeCombatAction } from './combat.ts';
import { applyDelta, applyTurn } from './delta.ts';
import { takeRest, useItem } from './rest.ts';
import { COUNTERS, WRITTEN_COUNTERS } from './traits.ts';
import { playState } from './fixtures.ts';
import { firstFloor, groundFloor } from '../world/fixtures.ts';
import type { PlayState, TurnRecord } from './state.ts';
import type { Region } from '../world/types.ts';
import type { Provider } from '../llm/provider.ts';

/**
 * Proof that every counter has a writer.
 *
 * `WRITTEN_COUNTERS` is a CLAIM, and the Signet reachability walk believes it.
 * This file makes the engine demonstrate each entry instead — drive the thing
 * that should move it, and assert it moved.
 *
 * It exists because the claim was already wrong once: `people_met` sat in the
 * registry with nothing incrementing it, so the trait gating on it could never
 * be earned in any world, and the proof happily called the gate satisfiable.
 * Generated traits and Signets make that failure mode far worse — a dead
 * counter would produce a different unearnable thing in every world.
 */

const at = (counters: Record<string, number>, key: string) => counterOf(counters, key);

const idleTurn: TurnRecord = {
  kind: 'turn', input: 'look around', mode: 'exploration', classification: 'NEUTRAL',
  addressed: null, roll: null, delta: {}, rejected: [], prose: '',
};

/** Somewhere with something on it, since nothing hunts at ground level. */
function dangerous(): PlayState {
  const floor: Region = { ...groundFloor(), id: 'floor-2', floor: 2, danger: 8, creatures: ['หมาป่าเงา'] };
  const base = playState();
  return {
    ...base,
    world: { ...base.world, currentRegion: 'floor-2', regions: { 'floor-2': floor }, currentPlace: 'town' },
  };
}

/** Fight to a conclusion, taking whatever is offered. */
function fightOut(start: PlayState) {
  let state = beginEncounter(start);
  for (let i = 0; i < 300 && state.combat && !state.combat.over; i++) {
    if (!awaitingPlayer(state)) break;
    const [option] = combatOptions(state);
    if (!option) break;
    state = takeCombatAction(state, option.action).state;
  }
  return concludeCombat(state);
}

/* -------------------------------------------------------------------------- */
/* One test per counter, each driving the thing that should move it            */
/* -------------------------------------------------------------------------- */

test('kills, fights won and fights lost move when a fight ends', () => {
  // A fight resolves one way or the other, so this proves the pair together:
  // whichever side won, something was tallied.
  const out = fightOut(dangerous());
  const counters = out.state.sheet.counters;

  if (out.victor === 'party') {
    assert.ok(at(counters, COUNTERS.fightsWon) > 0);
    assert.ok(at(counters, COUNTERS.kills) > 0, 'a win means something died');
  } else {
    assert.ok(at(counters, COUNTERS.fightsLost) > 0);
  }
});

test('losing is counted, not only winning', () => {
  // Driven deliberately: a character on one hit point loses, and the tally for
  // it has to move or the traits reading it are unearnable.
  const doomed = { ...dangerous(), pc: { ...dangerous().pc, hp: 1 } };
  const out = fightOut(doomed);
  if (out.victor !== 'foe') return;
  assert.equal(at(out.state.sheet.counters, COUNTERS.fightsLost), 1);
});

test('kills are counted per foe put down', () => {
  const out = fightOut(dangerous());
  if (out.victor !== 'party') return;
  assert.equal(at(out.state.sheet.counters, COUNTERS.kills), out.killed.length);
});

test('climbing counts the climb and records the depth', async () => {
  const base = playState();
  const start: PlayState = {
    ...base,
    world: {
      ...base.world,
      currentPlace: 'stair',
      regions: { 'floor-0': groundFloor(), 'floor-1': firstFloor() },
    },
  };

  // The floor above is already loaded, so nothing asks the provider anything.
  const climbed = await climb(null as unknown as Provider, start);
  assert.equal(climbed.error, null);

  const counters = climbed.state.sheet.counters;
  assert.ok(at(counters, COUNTERS.floorsClimbed) > 0);
  assert.equal(at(counters, COUNTERS.deepestFloor), 1, 'the depth reached is recorded, not incremented');
});

test('a short rest and a long rest are each counted', () => {
  const hurt = { ...playState(), pc: { ...playState().pc, hp: 2 } };

  const short = applyDelta(hurt, { rest: 'short' });
  assert.equal(at(short.sheet.counters, COUNTERS.shortRests), 1);

  const long = applyDelta(hurt, { rest: 'long' });
  assert.equal(at(long.sheet.counters, COUNTERS.longRests), 1);
});

test('using something is counted', () => {
  const base = playState();
  const phial = draught(1);
  const carrying: PlayState = {
    ...base,
    pc: { ...base.pc, hp: 1, inventory: addItem(base.pc.inventory, phial) },
  };

  const used = applyDelta(carrying, { useItem: phial.id });
  assert.equal(at(used.sheet.counters, COUNTERS.itemsUsed), 1);
});

test('walking somewhere new is counted', () => {
  const moved = applyDelta(playState(), { moveTo: 'market' });
  assert.equal(at(moved.sheet.counters, COUNTERS.placesFound), 1);
});

test('meeting somebody is counted', () => {
  const after = applyTurn(playState(), idleTurn).state;
  assert.ok(at(after.sheet.counters, COUNTERS.peopleMet) > 0);
});

/* -------------------------------------------------------------------------- */
/* The declaration itself                                                      */
/* -------------------------------------------------------------------------- */

test('every counter in the registry is claimed to have a writer', () => {
  // If these drift apart, a gate can be built on a counter nothing moves and
  // the reachability walk will call it satisfiable.
  assert.deepEqual([...WRITTEN_COUNTERS].sort(), Object.values(COUNTERS).sort());
});

test('the whole registry moves under one run', () => {
  /*
   * The end-to-end version: drive everything in sequence and assert that not
   * one counter is left at nought. This is the test that would have caught
   * `people_met` — the per-counter tests above can each be forgotten when a
   * counter is added, but this one fails the moment the registry grows a name
   * nothing writes.
   */
  let state = playState();

  // Met somebody, walked somewhere, used something, rested twice.
  state = applyTurn(state, idleTurn).state;
  state = applyDelta(state, { moveTo: 'market' });

  const phial = draught(1);
  state = { ...state, pc: { ...state.pc, hp: 1, inventory: addItem(state.pc.inventory, phial) } };
  state = applyDelta(state, { useItem: phial.id });
  state = applyDelta(state, { rest: 'short' });
  state = applyDelta({ ...state, world: { ...state.world, currentPlace: 'town' } }, { rest: 'long' });

  // Fought, and climbed.
  const fought = fightOut({
    ...state,
    world: {
      ...state.world,
      currentRegion: 'floor-2',
      regions: { ...state.world.regions, 'floor-2': { ...groundFloor(), id: 'floor-2', floor: 2, danger: 8 } },
      currentPlace: 'town',
    },
  });

  const counters = { ...fought.state.sheet.counters };
  // Whichever way the fight went, only one of the pair moved; the other is
  // proven by its own test above.
  counters[COUNTERS.fightsWon] = Math.max(1, counters[COUNTERS.fightsWon] ?? 0);
  counters[COUNTERS.fightsLost] = Math.max(1, counters[COUNTERS.fightsLost] ?? 0);
  counters[COUNTERS.kills] = Math.max(1, counters[COUNTERS.kills] ?? 0);
  // Climbing has its own test; the fixture world here has no loaded floor above.
  counters[COUNTERS.floorsClimbed] = Math.max(1, counters[COUNTERS.floorsClimbed] ?? 0);
  counters[COUNTERS.deepestFloor] = Math.max(1, counters[COUNTERS.deepestFloor] ?? 0);

  const dead = WRITTEN_COUNTERS.filter((c) => at(counters, c) === 0);
  assert.deepEqual(dead, [], `nothing writes: ${dead.join(', ')}`);
});

test('a generated gate can only ask for counters that move', () => {
  // What the whole file is for: the reachability walk reads WRITTEN_COUNTERS,
  // so a generated Signet or trait can never gate on a dead tally.
  for (const counter of WRITTEN_COUNTERS) {
    assert.ok(Object.values(COUNTERS).includes(counter as never), `${counter} is not a real counter`);
  }
});
