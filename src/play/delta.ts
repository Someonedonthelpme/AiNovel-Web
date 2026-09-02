import { applyDrift } from '../character/drift.ts';
import { bumpCounter } from '../character/persona.ts';
import { awardTraits, COUNTERS } from './traits.ts';
import type { Trait } from './traits.ts';
import { traitsFor } from './traitbook.ts';
import { applySheetAction } from './sheetaction.ts';
import type { SheetRecord } from './sheetaction.ts';
import type { AxisChange, DriftCause } from '../character/drift.ts';
import { readPlayerRegister } from '../llm/register.ts';
import { findItem, equip } from '../items/types.ts';
import { beginEncounter, concludeCombat, takeCombatAction } from './combat.ts';
import { canRest, takeRest, useItem } from './rest.ts';
import type { PlayState, TurnRecord, WorldDelta } from './state.ts';
import { activeRegion, exitsFrom, moveWithinRegion } from '../world/travel.ts';
import { TRUST_MAX, TRUST_MIN } from '../world/types.ts';
import type { Fact, World } from '../world/types.ts';

/**
 * The trust boundary between the model and the world.
 *
 * The Director PROPOSES changes; this module decides which of them are legal and
 * applies only those. An illegal move, an unknown person or a place that is not
 * adjacent is refused with a reason rather than obeyed — and refusing one field
 * never discards the rest of the turn.
 */

export type ValidatedDelta = { delta: WorldDelta; rejected: string[] };

const MAX_TIME_PER_TURN = 3;
const MAX_TRUST_SWING = 3;

export function validateDelta(state: PlayState, proposed: WorldDelta): ValidatedDelta {
  const rejected: string[] = [];
  const delta: WorldDelta = {};
  const region = activeRegion(state.world);

  if (proposed.moveTo !== undefined) {
    const reachable = exitsFrom(state.world);
    if (proposed.moveTo === state.world.currentPlace) {
      rejected.push(`moveTo "${proposed.moveTo}": already there`);
    } else if (!reachable.includes(proposed.moveTo)) {
      rejected.push(`moveTo "${proposed.moveTo}": not connected to "${state.world.currentPlace}"`);
    } else {
      delta.moveTo = proposed.moveTo;
    }
  }

  if (proposed.trust) {
    const trust: Record<string, number> = {};
    for (const [id, change] of Object.entries(proposed.trust)) {
      if (!state.world.people[id]) {
        rejected.push(`trust "${id}": no such person`);
        continue;
      }
      if (!Number.isFinite(change)) {
        rejected.push(`trust "${id}": not a number`);
        continue;
      }
      // One turn should not be able to swing a relationship end to end.
      const clamped = Math.max(-MAX_TRUST_SWING, Math.min(MAX_TRUST_SWING, Math.round(change)));
      if (clamped !== change) rejected.push(`trust "${id}": ${change} capped to ${clamped}`);
      trust[id] = clamped;
    }
    if (Object.keys(trust).length) delta.trust = trust;
  }

  if (proposed.revealExit !== undefined) {
    if (!region) {
      rejected.push('revealExit: the current region is not loaded in full detail');
    } else if (!region.places.some((p) => p.id === proposed.revealExit)) {
      rejected.push(`revealExit "${proposed.revealExit}": no such place in this region`);
    } else if (region.exit !== null && region.exit !== proposed.revealExit) {
      // It REVEALS a way up; it does not move one. Letting this through relocated
      // the staircase mid-play — the map went on pointing at the Tower Stair
      // while the real exit had become the gate out of town, and the floor could
      // not be climbed from anywhere the player was told to stand.
      rejected.push(`revealExit "${proposed.revealExit}": the way up is already known`);
    } else {
      delta.revealExit = proposed.revealExit;
    }
  }

  const facts = (proposed.learnFacts ?? []).map((f) => f.trim()).filter(Boolean);
  if (facts.length) delta.learnFacts = facts;

  if (proposed.flags && Object.keys(proposed.flags).length) delta.flags = { ...proposed.flags };

  if (proposed.startCombat) {
    const region = activeRegion(state.world);
    if (!region) rejected.push('startCombat: the current region is not loaded in full detail');
    else if (region.danger <= 0) rejected.push('startCombat: nothing hunts at ground level');
    else if (state.combat && !state.combat.over) rejected.push('startCombat: a fight is already happening');
    else delta.startCombat = true;
  }

  if (proposed.useItem !== undefined) {
    const item = findItem(state.pc.inventory, proposed.useItem);
    if (!item) rejected.push(`useItem "${proposed.useItem}": you are not carrying that`);
    else if (item.kind !== 'consumable' || !item.effect) rejected.push(`useItem "${item.name}": not something you can use up`);
    else delta.useItem = proposed.useItem;
  }

  if (proposed.equipItem !== undefined) {
    const item = findItem(state.pc.inventory, proposed.equipItem);
    if (!item) rejected.push(`equipItem "${proposed.equipItem}": you are not carrying that`);
    else if (item.kind !== 'equipment' || !item.slot) rejected.push(`equipItem "${item.name}": not something you can wear or wield`);
    else delta.equipItem = proposed.equipItem;
  }

  if (proposed.rest !== undefined) {
    const kind = proposed.rest === 'long' ? 'long' : 'short';
    const check = canRest(state, kind);
    if (!check.ok) rejected.push(`rest: ${check.reason}`);
    else delta.rest = kind;
  }

  if (proposed.timeSpent !== undefined) {
    const t = Math.max(0, Math.min(MAX_TIME_PER_TURN, Math.round(proposed.timeSpent || 0)));
    delta.timeSpent = t;
  }

  return { delta, rejected };
}

const clampTrust = (n: number) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));

/**
 * Apply an already-validated delta.
 *
 * Turn accounting lives here and nowhere else: `moveWithinRegion` advances the
 * turn itself, so a turn without a move has to advance it explicitly. Every path
 * through this function moves the clock exactly one turn.
 */
export function applyDelta(state: PlayState, delta: WorldDelta): PlayState {
  if (state.ended) return state;

  let world: World = state.world;
  let turnAdvanced = false;

  let discovered = false;
  if (delta.moveTo) {
    const before = activeRegion(world)?.places.find((p) => p.id === delta.moveTo)?.discovered ?? true;
    const moved = moveWithinRegion(world, delta.moveTo);
    if (moved.kind === 'moved') {
      world = moved.world;
      turnAdvanced = true;
      discovered = !before;
    }
  }

  if (delta.trust) {
    const people = { ...world.people };
    for (const [id, change] of Object.entries(delta.trust)) {
      const person = people[id];
      if (!person) continue;
      people[id] = { ...person, trust: clampTrust(person.trust + change), lastSeenTurn: world.turn };
    }
    world = { ...world, people };
  }

  if (delta.revealExit) {
    const region = activeRegion(world);
    if (region) {
      world = {
        ...world,
        regions: { ...world.regions, [region.id]: { ...region, exit: delta.revealExit } },
      };
    }
  }

  if (delta.learnFacts?.length) {
    const known = new Set(world.facts.map((f) => f.text));
    const added: Fact[] = delta.learnFacts
      .filter((text) => !known.has(text))
      .map((text, i) => ({
        id: `f${world.facts.length + i + 1}`,
        text,
        region: world.currentRegion,
        people: [],
        establishedAtTurn: world.turn,
      }));
    if (added.length) world = { ...world, facts: [...world.facts, ...added] };
  }

  if (delta.flags) world = { ...world, flags: { ...world.flags, ...delta.flags } };

  if (!turnAdvanced) world = { ...world, turn: world.turn + 1 };

  let next: PlayState = { ...state, world };

  // Somewhere you had never been. Counted here rather than in travel, because
  // travel is also used for climbing, which has its own tally.
  if (discovered) {
    next = { ...next, sheet: { ...next.sheet, counters: bumpCounter(next.sheet.counters, COUNTERS.placesFound) } };
  }

  /*
   * Faces you had not seen before.
   *
   * `people_met` was in the counter registry and NOTHING EVER WROTE IT, so the
   * trait gating on it could never be earned in any world — and the Signet
   * proof happily treated it as live, because the registry says a name exists,
   * not that anything increments it.
   *
   * `lastSeenTurn` is the record of having met somebody: nought means never.
   */
  const standing = activeRegion(next.world)?.places.find((p) => p.id === next.world.currentPlace);
  const strangers = (standing?.people ?? []).filter(
    (id) => next.world.people[id] && next.world.people[id].lastSeenTurn === 0,
  );

  if (strangers.length) {
    const people = { ...next.world.people };
    for (const id of strangers) people[id] = { ...people[id], lastSeenTurn: next.world.turn };

    let counters = next.sheet.counters;
    for (const _ of strangers) counters = bumpCounter(counters, COUNTERS.peopleMet);

    next = { ...next, world: { ...next.world, people }, sheet: { ...next.sheet, counters } };
  }

  // Carrying and recovering. These run after the world has moved, so resting
  // at a place you have just walked into is resolved where you now stand.
  if (delta.equipItem) {
    const equipped = equip(next.pc.inventory, delta.equipItem);
    if (!equipped.error) next = { ...next, pc: { ...next.pc, inventory: equipped.inventory } };
  }

  if (delta.useItem) {
    const used = useItem(next, delta.useItem);
    if (!used.error) {
      next = used.state;
      next = { ...next, sheet: { ...next.sheet, counters: bumpCounter(next.sheet.counters, COUNTERS.itemsUsed) } };
    }
  }

  if (delta.rest) {
    const rested = takeRest(next, delta.rest);
    if (!rested.error) {
      next = rested.state;
      const counter = delta.rest === 'long' ? COUNTERS.longRests : COUNTERS.shortRests;
      next = { ...next, sheet: { ...next.sheet, counters: bumpCounter(next.sheet.counters, counter) } };
    }
  }

  return next;
}

/**
 * What this turn did to the people in it.
 *
 * Derived from the record rather than passed in, so replaying a log produces
 * exactly the same drift — if this lived only in `playTurn`, a resumed session
 * would quietly lose every personality change that had ever happened.
 */
function causesFor(state: PlayState, record: TurnRecord): { npc: DriftCause[]; pc: DriftCause[] } {
  const npc: DriftCause[] = [];
  const pc: DriftCause[] = [];

  if (record.roll) {
    npc.push({ kind: 'check', tier: record.roll.tier });
    pc.push({ kind: 'check', tier: record.roll.tier });
  }

  const trustChange = record.addressed ? record.delta.trust?.[record.addressed] ?? 0 : 0;
  if (trustChange) npc.push({ kind: 'trust', change: trustChange });

  if (record.addressed) {
    // How the player chose to speak is itself an act, and a repeated one
    // eventually changes how they are regarded.
    npc.push({ kind: 'address', tone: readPlayerRegister(record.input).tone });
  }

  if (record.delta.timeSpent) pc.push({ kind: 'travel', cost: record.delta.timeSpent });

  const region = state.world.regions[state.world.currentRegion];
  if (region && region.detail === 'full' && region.danger > 0) {
    pc.push({ kind: 'danger', level: region.danger });
  }

  return { npc, pc };
}

export type TurnOutcome = {
  state: PlayState;
  /** Dispositions that actually shifted. Worth narrating; most turns have none. */
  shifts: AxisChange[];
  /** Traits that came true this turn. Announced once, not every turn after. */
  earned: Trait[];
};

export function applyTurn(state: PlayState, record: TurnRecord): TurnOutcome {
  let moved = applyDelta(state, record.delta);

  if (record.delta.startCombat) {
    const fight = beginEncounter(moved);
    if (record.combatActions) {
      // REPLAY. The decisions are known, and every roll comes from state, so
      // this reproduces the original encounter exactly.
      let fighting = fight;
      for (const action of record.combatActions) {
        fighting = takeCombatAction(fighting, action).state;
      }
      moved = concludeCombat(fighting).state;
    } else {
      // LIVE. The fight is opened and left running; the caller drives it, and
      // records the decisions onto this turn when it ends.
      moved = fight;
    }
  }

  if (moved.ended) return { state: moved, shifts: [], earned: [] };

  const causes = causesFor(moved, record);
  const player = applyDrift(moved.sheet, causes.pc);

  let world = moved.world;
  let shifts: AxisChange[] = [];

  const person = record.addressed ? world.people[record.addressed] : undefined;
  if (person && causes.npc.length) {
    const drifted = applyDrift(person, causes.npc);
    world = { ...world, people: { ...world.people, [person.id]: { ...person, ...drifted.persona } } };
    shifts = drifted.changed;
  }

  // Traits are checked last, once everything that could have moved a counter,
  // a score or a personality axis has already moved. Doing it inside the fold
  // rather than in the live loop is what keeps a replayed session unlocking the
  // same traits in the same order.
  const drifted: PlayState = { ...moved, world, sheet: { ...moved.sheet, ...player.persona } };
  // This world's own traits, not the global catalogue — a replayed log has to
  // earn the same ones at the same moments.
  const awarded = awardTraits(traitsFor(drifted.world.seed), drifted.sheet, drifted.pc.inventory);

  return { state: { ...drifted, sheet: awarded.sheet }, shifts, earned: awarded.earned };
}

export function foldPlay(initial: PlayState, events: readonly { kind: string }[]): PlayState {
  let state = initial;
  for (const event of events) {
    // Panel actions are folded exactly like turns. A sheet change that lived
    // only in memory would vanish on reload, which is the same trap the
    // in-memory fight and the lossy snapshot both fell into.
    if (event.kind === 'turn') state = applyTurn(state, event as TurnRecord).state;
    else if (event.kind === 'sheet') state = applySheetAction(state, (event as SheetRecord).action).state;
  }
  return state;
}
