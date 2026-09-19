import { applyDrift } from '../character/drift.ts';
import { bumpCounter } from '../character/persona.ts';
import { awardTraits, COUNTERS } from './traits.ts';
import type { Trait } from './traits.ts';
import { traitOriginOf, traitsFor } from './traitbook.ts';
import { applyClimb } from './climb.ts';
import type { ClimbRecord } from './climb.ts';
import { applySheetAction } from './sheetaction.ts';
import type { SheetRecord } from './sheetaction.ts';
import type { AxisChange, DriftCause } from '../character/drift.ts';
import { readPlayerRegister, registerConsequence } from '../llm/register.ts';
import { nudge, nudgeAll, PLAYER, trustToward } from '../social/edge.ts';
import { beliefsAfter, claimOf, ECHOING, witnessDeed } from '../social/deed.ts';
import { carry, seed } from '../social/ambient.ts';
import { firsthand } from '../character/belief.ts';
import type { Deed, Echo } from '../social/deed.ts';
import { lawFrom } from '../world/strata.ts';
import { amend, BINDINGS, CONSTRAINTS, forbids, rulesOf } from '../rules/ruleset.ts';
import { holderOf, priceOf, TRUST_TO_SELL } from '../world/holding.ts';
import { playerSubject } from './signetbook.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Edges } from '../social/edge.ts';
import { findItem, equip } from '../items/types.ts';
import { gearRulesFor } from './body.ts';
import { arrivalOpens, beginEncounter, concludeCombat, takeCombatAction } from './combat.ts';
import { advanceJourneys, fadeGrudges, setOut } from './journey.ts';
import { isWinter, TICKS_PER_HOUR } from '../world/calendar.ts';
import { passSightings, witnessSighting } from './sighting.ts';
import type { CombatAction, CombatOutcome } from './combat.ts';
import { canRest, takeRest, useItem } from './rest.ts';
import type { PlayState, TurnRecord, WorldDelta } from './state.ts';
import { activeRegion, clockOf, exitsFrom, moveWithinRegion, travelTime } from '../world/travel.ts';
import type { Fact, Link, PlaceId, RegionId, World } from '../world/types.ts';

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

/**
 * Who the model MEANT, when it names a person (approved 2026-09-19).
 *
 * The Director is shown `id "name"` and writes the name back as often as the id
 * ("Kaelen Gearwright", "KaelenGearwright", "Rylan, Harbor Guard"); refusing all
 * of those threw away nine "helped" deeds in ten, live. An id is taken as it is;
 * otherwise a name, ignoring case, spaces and punctuation (never letters, so Thai
 * survives), among the people HERE first and then anyone known. Exactly one match
 * or none: the vocabulary stays closed, and an ambiguous name is never guessed.
 */
export function personRef(state: PlayState, ref: string): { id: string } | { error: 'no such person' | 'ambiguous' } {
  const people = state.world.people;
  if (people[ref]) return { id: ref };
  const key = (text: string) => text.toLowerCase().replace(/[\s\p{P}]/gu, '');
  const wanted = new Set([key(ref), key(ref.split(',')[0])]);
  const matches = (ids: string[]) => ids.filter((id) => people[id] && wanted.has(key(people[id].name)));
  const region = activeRegion(state.world);
  const here = region?.places.find((p) => p.id === state.world.currentPlace)?.people ?? [];
  for (const pool of [here, Object.keys(people)]) {
    const found = [...new Set(matches(pool))];
    if (found.length === 1) return { id: found[0] };
    if (found.length > 1) return { error: 'ambiguous' };
  }
  return { error: 'no such person' };
}

/**
 * Why the player may NOT buy this settlement, or null when they may (DESIGN 6c
 * *Ownership*, O1). A deal is struck in person, in the place, with whoever holds
 * it, who must trust you, at a price you can pay, where the law lets you hold land.
 */
function refusalToSell(state: PlayState, placeId: string): string | null {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === placeId);
  if (!region || !place || placeId !== state.world.currentPlace) return 'not here';
  if (place.kind !== 'settlement') return 'not a settlement';
  const holder = holderOf(place, state.world.people);
  if (!holder) return 'no holder is here to deal with';
  if (holder === PLAYER) return 'already yours';
  if (forbids(state.world, playerSubject(state), 'holdSettlement')) return 'the law forbids you holding a settlement';
  if (trustToward(state.world.edges, holder) < TRUST_TO_SELL) return `the holder's trust is too low to sell`;
  if (state.pc.coin < priceOf(region.floor)) return `it costs ${priceOf(region.floor)} coin`;
  return null;
}

/** The deal, once `validateDelta` has allowed it: the place is yours, the coin is theirs. */
function bought(state: PlayState, placeId: string): PlayState {
  const region = activeRegion(state.world);
  if (!region) return state;
  return {
    ...state,
    pc: { ...state.pc, coin: state.pc.coin - priceOf(region.floor) },
    world: {
      ...state.world,
      regions: {
        ...state.world.regions,
        [region.id]: { ...region, places: region.places.map((p) => (p.id === placeId ? { ...p, holder: PLAYER } : p)) },
      },
    },
  };
}

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
    for (const [said, change] of Object.entries(proposed.trust)) {
      const who = personRef(state, said);
      if ('error' in who) {
        rejected.push(`trust "${said}": ${who.error}`);
        continue;
      }
      const id = who.id;
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

  /*
   * A deed has to have been done to somebody who was THERE.
   *
   * Not merely somebody who exists: a deed is the thing witnesses see, and one
   * done to a person standing on another floor has no witnesses, no spread and
   * no meaning. The kind is already narrowed to what a model may claim; this is
   * the other half of the guard.
   */
  if (proposed.deed) {
    const here = new Set(region?.places.find((p) => p.id === state.world.currentPlace)?.people ?? []);
    const who = personRef(state, proposed.deed.toward);
    if ('error' in who) {
      rejected.push(`deed "${proposed.deed.kind}": ${who.error}`);
    } else if (!here.has(who.id)) {
      rejected.push(`deed "${proposed.deed.kind}": ${proposed.deed.toward} is not here`);
    } else {
      delta.deed = { ...proposed.deed, toward: who.id };
    }
  }

  if (proposed.amendLaw) {
    // The trust boundary for the one field that can change the rules. A model
    // that could name its own constraint would be writing laws nothing
    // enforces — the exact failure the closed vocabulary exists to prevent.
    const { constraint, binds } = proposed.amendLaw;
    /*
     * A law may bind a KIND of being, and that is the one binding whose
     * vocabulary belongs to the world rather than the engine — so it is checked
     * against the world's own tree. A group nothing in this world is would be a
     * law about nobody, which is the failure the closed vocabulary exists to
     * prevent, and a SPECIES is refused as well: law binds a group, like body,
     * habitat and kinship.
     */
    const named = binds !== null && typeof binds === 'object' ? binds.group : null;
    if (!(CONSTRAINTS as readonly string[]).includes(constraint)) {
      rejected.push(`amendLaw "${constraint}": no such rule in this engine`);
    } else if (named !== null) {
      const group = (state.world.species ?? []).find((k) => k.id === named && k.level === 'group');
      if (!group) rejected.push(`amendLaw "${constraint}": "${named}" is no group this world holds`);
      else delta.amendLaw = { constraint, binds };
    } else if (binds !== null && !(BINDINGS as readonly string[]).includes(binds as string)) {
      rejected.push(`amendLaw "${constraint}": "${binds}" binds nobody`);
    } else {
      delta.amendLaw = { constraint, binds };
    }
  }

  if (proposed.revealWay !== undefined) {
    const region = activeRegion(state.world);
    const place = region?.places.find((p) => p.id === proposed.revealWay);
    if (!place) {
      rejected.push(`revealWay "${proposed.revealWay}": no such place here`);
    } else if ((region?.exits ?? []).some((l) => l.via === place.id)) {
      rejected.push(`revealWay "${proposed.revealWay}": that way is already known`);
    } else {
      delta.revealWay = place.id;
    }
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
    else {
      delta.startCombat = true;
      if (proposed.startedBy === 'them') delta.startedBy = 'them';
    }
  }

  // Only the engine walks: a model able to propose a route would be choosing movement.
  if (proposed.walk !== undefined) rejected.push('walk: only the engine walks');

  if (proposed.acquirePlace !== undefined) {
    const why = refusalToSell(state, proposed.acquirePlace);
    if (why) rejected.push(`acquirePlace "${proposed.acquirePlace}": ${why}`);
    else delta.acquirePlace = proposed.acquirePlace;
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

/**
 * Where a newly found road leads.
 *
 * Pure in the world seed, the region and the place it leaves from — a name, not
 * a draw, so the live turn and every replay of it agree without the destination
 * having to be written into the log.
 */
function wayIdFor(seed: number, from: RegionId, via: PlaceId): RegionId {
  let hash = (seed ^ 0x7a11) >>> 0;
  for (const ch of `${from}/${via}`) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return `way-${hash.toString(36)}`;
}

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
  let movedFrom: string | null = null;

  let discovered = false;
  // A walk charges each step it took, where a moveTo charges its one link.
  let walkedSteps = 0;
  for (const to of delta.walk ?? []) {
    const before = activeRegion(world)?.places.find((p) => p.id === to)?.discovered ?? true;
    const moved = moveWithinRegion(world, to);
    if (moved.kind !== 'moved') break;
    walkedSteps += travelTime({ ...moved.world, clock: clockOf(state.world) }, world.currentPlace, to);
    world = { ...moved.world, turn: world.turn };
    turnAdvanced = true;
    discovered ||= !before;
  }
  if (turnAdvanced) world = { ...world, turn: state.world.turn + 1 };
  if (delta.moveTo) {
    const before = activeRegion(world)?.places.find((p) => p.id === delta.moveTo)?.discovered ?? true;
    const moved = moveWithinRegion(world, delta.moveTo);
    if (moved.kind === 'moved') {
      movedFrom = world.currentPlace;
      world = moved.world;
      turnAdvanced = true;
      discovered = !before;
    }
  }

  if (delta.trust) {
    const people = { ...world.people };
    let edges = world.edges;
    for (const [id, change] of Object.entries(delta.trust)) {
      const person = people[id];
      if (!person) continue;
      // The change lands on THEIR edge toward the player, which is the
      // direction it always meant — the player's own view of them is a
      // separate edge that nothing has had a way to move until now.
      edges = nudge(edges, id, PLAYER, 'trust', change);
      people[id] = { ...person, lastSeenTurn: world.turn };
    }
    world = { ...world, people, edges };
  }

  if (delta.amendLaw) {
    // The world's law, changed by something that happened in it. Stored on the
    // world rather than applied to the preset, which every other run shares.
    world = { ...world, rules: amend(rulesOf(world), delta.amendLaw.constraint, delta.amendLaw.binds) };
  }

  if (delta.revealWay) {
    const region = activeRegion(world);
    if (region) {
      /*
       * Where the road goes is decided HERE, from state alone.
       *
       * No rng draw: the id is a function of the world's seed, the region and
       * the place it leaves from, so the fold mints the same destination on
       * every replay without anything extra being logged.
       */
      const to = wayIdFor(world.seed, region.id, delta.revealWay);
      const link: Link = { to, via: delta.revealWay, floor: region.floor };
      world = {
        ...world,
        regions: {
          ...world.regions,
          [region.id]: { ...region, exits: [...(region.exits ?? []), link] },
        },
      };
    }
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

  // THE CLOCK (7.1a). This turn covers the time its action took: a move its link,
  // anything else what the Director said it cost, and never nothing.
  // The season is read before this turn's time is added: you set out in it.
  const walked = walkedSteps + (movedFrom ? travelTime({ ...world, clock: clockOf(state.world) }, movedFrom, world.currentPlace) : 0);
  const elapsed = Math.max(1, delta.timeSpent ?? 0, walked);
  world = { ...world, clock: clockOf(state.world) + elapsed };

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
    const equipped = equip(next.pc.inventory, delta.equipItem, gearRulesFor(next));
    if (!equipped.error) next = { ...next, pc: { ...next.pc, inventory: equipped.inventory } };
  }

  if (delta.acquirePlace) next = bought(next, delta.acquirePlace);

  if (delta.useItem) {
    const used = useItem(next, delta.useItem);
    if (!used.error) {
      next = used.state;
      next = { ...next, sheet: { ...next.sheet, counters: bumpCounter(next.sheet.counters, COUNTERS.itemsUsed) } };
    }
  }

  if (delta.rest) {
    // The rest starts when the turn's walking ends, and its hours ARE the turn's time.
    const rested = takeRest({ ...next, world: { ...next.world, clock: clockOf(state.world) + walked } }, delta.rest);
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
/** How often time passing takes a point of a need (7.1e-iv). */
const FOOD_EVERY = 4 * TICKS_PER_HOUR;
const REST_EVERY = 2 * TICKS_PER_HOUR;
/** In winter, outside a settlement, both come half as fast again (7.1e-v). */
const COLD = 1.5;

/** How many multiples of `every` the clock crossed between two ticks. */
const marks = (from: number, to: number, every: number) => Math.floor(to / every) - Math.floor(from / every);

function causesFor(state: PlayState, record: TurnRecord, from: number, to: number): { npc: DriftCause[]; pc: DriftCause[] } {
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

  // Needs drain by the HOURS the turn covered, not by the turn (7.1e-iv).
  // Sleeping does not tire you; it still makes you hungry.
  const place = activeRegion(state.world)?.places.find((p) => p.id === state.world.currentPlace);
  const cold = isWinter(state.world) && place?.kind !== 'settlement' ? COLD : 1;
  pc.push({
    kind: 'time',
    food: marks(from, to, FOOD_EVERY / cold),
    rest: record.delta.rest ? 0 : marks(from, to, REST_EVERY / cold),
  });

  // Resting was a `DriftCause` that nothing ever emitted, so the one thing that
  // restores a need could never reach the person it restores.
  if (record.delta.rest) pc.push({ kind: 'rest', quality: record.delta.rest === 'long' ? 3 : 1 });

  const region = state.world.regions[state.world.currentRegion];
  if (region && region.detail === 'full' && region.danger > 0) {
    pc.push({ kind: 'danger', level: region.danger });
  }

  return { npc, pc };
}

/**
 * What a turn did to the relationships in it.
 *
 * In the FOLD rather than the live loop, for the same reason drift is: a
 * resumed session that quietly lost every relationship change would break the
 * contract that the log is truth.
 *
 * Two different things happen here, and keeping them apart matters. What passes
 * between the player and the person they SPOKE TO is a private exchange. What
 * everybody standing there SAW is a deed, and deeds travel.
 */
function edgesAfter(state: PlayState, record: TurnRecord): Edges | undefined {
  const person = record.addressed ? state.world.people[record.addressed] : undefined;
  let edges = state.world.edges;

  if (person) {
    // Having dealt with somebody at all is what forms an edge, and it is why
    // the graph stays as small as the story that actually happened.
    edges = nudge(edges, person.id, PLAYER, 'familiarity', 1);

    // HOW the player spoke, which until now was computed and thrown away.
    const { tone } = readPlayerRegister(record.input);
    edges = nudgeAll(edges, person.id, PLAYER, registerConsequence(tone, person.status).nudges);

    // And how the exchange actually went. A check they lost raises what they
    // think you are worth; one they won lowers it.
    if (record.roll) {
      const by = record.roll.tier === 'hit' ? 1 : record.roll.tier === 'miss' ? -1 : 0;
      edges = nudge(edges, person.id, PLAYER, 'regard', by);
    }
  }

  return edges;
}

/**
 * What this turn did that other people could SEE.
 *
 * Deliberately conservative: only acts the engine can be certain happened, from
 * things it already resolves. A deed inferred from prose would be a model
 * deciding a consequence, which is the one thing this codebase does not allow.
 */
function deedsIn(state: PlayState, record: TurnRecord, killed: number, spared: CombatOutcome['spared'] = []): Deed[] {
  const at = state.world.currentPlace;
  const out: Deed[] = [];

  // Speaking roughly to somebody is an act, and it is an act with an audience.
  if (record.addressed && state.world.people[record.addressed]) {
    const { tone } = readPlayerRegister(record.input);
    const status = state.world.people[record.addressed].status;
    if (tone === 'crude') {
      out.push({
        // The same words are an insult upward and a threat downward — the
        // asymmetry the register already prices, read as a deed.
        kind: status === 'inferior' ? 'threatened' : 'insulted',
        doer: PLAYER,
        toward: record.addressed,
        at,
      });
    }
  }

  /*
   * And what the Director judged, which is the half no rule can see: a favour
   * done, a slight meant to land in front of people, menace in polite words.
   * It named the deed; the mark decides everything else about it.
   */
  if (record.delta.deed) {
    out.push({ kind: record.delta.deed.kind, doer: PLAYER, toward: record.delta.deed.toward, at });
  }

  // Drawing on somebody is the plainest deed there is — being jumped is not one.
  if (record.delta.startCombat && record.delta.startedBy !== 'them') out.push({ kind: 'drewOn', doer: PLAYER, at });

  // A kill is seen whoever started it. One deed per fight, not per body: a mass
  // foe is nobody in particular, and three rats are not three times the notoriety.
  if (killed > 0) out.push({ kind: 'killed', doer: PLAYER, at });

  // Letting somebody live who had yielded — `spared`'s first writer. A person
  // feels it as the one spared; a crowd foe let go is one deed, like a kill.
  for (const who of spared) if (who.person) out.push({ kind: 'spared', doer: PLAYER, toward: who.person, at });
  if (spared.some((who) => !who.person)) out.push({ kind: 'spared', doer: PLAYER, at });

  return out;
}

/**
 * Apply every deed of a turn: who saw it, how far it got, what it cost.
 *
 * Returns the world, because a deed touches three things that live in different
 * places — the edges, what each person now BELIEVES, and how the place regards
 * you.
 */
function afterDeeds(world: World, deeds: readonly Deed[], rules: Ruleset): World {
  if (deeds.length === 0) return world;

  const region = world.regions[world.currentRegion];
  const place = region?.detail === 'full'
    ? region.places.find((p) => p.id === world.currentPlace)
    : undefined;
  // Somebody spared was there to be spared, whether or not they live at this place.
  const spared = deeds.flatMap((d) => (d.kind === 'spared' && d.toward ? [d.toward] : []));
  const present = [...new Set([...(place?.people ?? []), ...spared])];

  let edges = world.edges;
  let people = world.people;
  let ambient = world.ambient;
  let standing = 0;

  for (const deed of deeds) {
    const after = witnessDeed(edges, deed, present, rules.knowledge.spreadDepth);
    edges = after.edges;
    standing += after.standing;

    // What each of them now holds true. This is where the belief model stops
    // being a tested island and starts being something a turn produces.
    for (const [who, belief] of after.knowers) {
      const person = people[who];
      if (!person) continue;
      people = { ...people, [who]: { ...person, beliefs: beliefsAfter(person.beliefs, belief) } };
    }

    // And it is in the air here, whether or not anybody modelled was standing
    // in it — which is what lets a market know a thing without a market's worth
    // of people being simulated.
    ambient = seed(ambient, world.currentPlace, firsthand(claimOf(deed)));
  }

  const moved = Math.round(standing * rules.knowledge.reputationWeight);
  const reputation = moved === 0
    ? world.reputation
    : { ...world.reputation, [world.currentRegion]: (world.reputation?.[world.currentRegion] ?? 0) + moved };

  return { ...world, edges, people, ambient, reputation, ...echoesAfter(world, deeds, place?.name ?? '') };
}

/** The weighty deeds of this turn, kept for the eras above, if this floor is an era's. */
function echoesAfter(world: World, deeds: readonly Deed[], where: string): { echoes?: Echo[] } {
  const floor = world.regions[world.currentRegion]?.floor;
  if (floor === undefined || lawFrom(world, floor, 'time')?.laws?.time !== 'era') return {};
  const kept = deeds
    .filter((d) => (ECHOING as readonly string[]).includes(d.kind))
    .map((d): Echo => ({
      floor, kind: d.kind, where,
      ...(d.toward && world.people[d.toward] ? { whom: world.people[d.toward].name } : {}),
    }));
  return kept.length ? { echoes: [...(world.echoes ?? []), ...kept] } : {};
}

/**
 * News moving across the map, once per turn.
 *
 * In the fold like everything else that changes the world between turns, and
 * deterministic, so a replayed session hears the same things in the same places.
 */
function afterTraffic(world: World, rules: Ruleset): World {
  if (!world.ambient) return world;
  const region = world.regions[world.currentRegion];
  if (region?.detail !== 'full') return world;

  return {
    ...world,
    ambient: carry(world.ambient, region.places, rules.knowledge.ambientHops, rules.knowledge.ambientFade),
  };
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
  // Whoever is on the road covers the time this turn took (7.1b).
  moved = { ...moved, world: advanceJourneys(moved.world, clockOf(state.world), clockOf(moved.world)) };
  let killed = 0;
  let spared: CombatOutcome['spared'] = [];
  let fled: string[] = [];

  // A fight opens when the Director says so, or when somebody ARRIVES — derived
  // from state, so a replay opens the same one.
  const arriving = !record.delta.startCombat && arrivalOpens(moved);
  if (record.delta.startCombat || arriving) {
    const fight = beginEncounter(moved, arriving ? 'them' : record.delta.startedBy);
    if (record.combatActions) {
      // REPLAY. The decisions are known, and every roll comes from state, so
      // this reproduces the original encounter exactly.
      let fighting = fight;
      for (const action of record.combatActions) {
        fighting = takeCombatAction(fighting, action).state;
      }
      const outcome = concludeCombat(fighting);
      moved = outcome.state;
      killed = outcome.killed.length;
      spared = outcome.spared;
      fled = outcome.fled;
    } else {
      // LIVE. The fight is opened and left running; the caller drives it, and
      // records the decisions onto this turn when it ends.
      moved = fight;
    }
  }

  if (moved.ended) return { state: moved, shifts: [], earned: [] };

  const causes = causesFor(moved, record, clockOf(state.world), clockOf(moved.world));
  const rules = rulesOf(moved.world);
  /*
   * WHO is being worn down, and by whose rules.
   *
   * Both drift calls used the STANDARD default, so a world's own
   * `driftThreshold` and `suitSwing` never reached the one place a character
   * actually changes — the same bug `dangerFor(floor)` had in the generator.
   */
  const kindOf = (who: { species?: string }) =>
    moved.world.species?.find((k) => k.id === who.species);

  const player = applyDrift(moved.sheet, causes.pc, rules, kindOf(moved.sheet));
  let world = afterTraffic(
    afterDeeds({ ...moved.world, edges: edgesAfter(moved, record) }, deedsIn(moved, record, killed, spared), rules),
    rules,
  );
  let shifts: AxisChange[] = [];

  const person = record.addressed ? world.people[record.addressed] : undefined;
  if (person && causes.npc.length) {
    const drifted = applyDrift(person, causes.npc, rules, kindOf(person));
    world = { ...world, people: { ...world.people, [person.id]: { ...person, ...drifted.persona } } };
    shifts = drifted.changed;
  }

  // Traits are checked last, once everything that could have moved a counter,
  // a score or a personality axis has already moved. Doing it inside the fold
  // rather than in the live loop is what keeps a replayed session unlocking the
  // same traits in the same order.
  // Word of the player passes a hop, then whoever is here sees them (7.1c).
  world = witnessSighting(passSightings(world));
  // Grudges nothing fed fade, over days; whoever they sent turns back (7.1f).
  world = fadeGrudges(state.world, world);
  // A grudge fed this turn sets out, once everything that could feed it has.
  world = setOut(state.world, world, fled);

  const drifted: PlayState = { ...moved, world, sheet: { ...moved.sheet, ...player.persona } };
  // This world's own traits, not the global catalogue — a replayed log has to
  // earn the same ones at the same moments.
  const awarded = awardTraits(traitsFor(drifted.world.seed, traitOriginOf(drifted)), drifted.sheet, drifted.pc.inventory);

  return { state: { ...drifted, sheet: awarded.sheet }, shifts, earned: awarded.earned };
}

/**
 * A live fight's end: what the server writes, and the state it saves.
 *
 * Re-folded from the state BEFORE the turn rather than concluded from the fight
 * as it stands. The live turn ran drift, deeds and traits when the fight OPENED,
 * replay runs them after it ends — and a kill is a deed, so the two orders no
 * longer agree. Folding the finished record is what replay does, so the saved
 * state and the log cannot disagree.
 */
export function settleFight(fight: { pre: PlayState; draft: TurnRecord; actions: readonly CombatAction[] }) {
  const record: TurnRecord = { ...fight.draft, combatActions: [...fight.actions] };
  return { record, state: applyTurn(fight.pre, record).state };
}

export function foldPlay(initial: PlayState, events: readonly { kind: string }[]): PlayState {
  let state = initial;
  for (const event of events) {
    // Panel actions are folded exactly like turns. A sheet change that lived
    // only in memory would vanish on reload, which is the same trap the
    // in-memory fight and the lossy snapshot both fell into.
    if (event.kind === 'turn') state = applyTurn(state, event as TurnRecord).state;
    else if (event.kind === 'sheet') state = applySheetAction(state, (event as SheetRecord).action).state;
    // A crossing carries the floor that was generated to make it, because a
    // model call cannot be repeated inside a synchronous fold.
    else if (event.kind === 'climb') state = applyClimb(state, event as ClimbRecord).state;
  }
  return state;
}
