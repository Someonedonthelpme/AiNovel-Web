import { arrivalOpens } from './combat.ts';
import { needsAfter } from './delta.ts';
import { advanceJourneys } from './journey.ts';
import type { PlayState, Stop, WalkTo } from './state.ts';
import { bestRoute, fieldEnds, fieldId, hubId, portalsOf, positionOf, tileSeconds } from '../world/map.ts';
import type { Cell, GameMap, MapId } from '../world/map.ts';
import { isNight, MINUTES_PER_TICK } from '../world/calendar.ts';
import { activeRegion, clockOf } from '../world/travel.ts';
import { NEED_MAX } from '../character/persona.ts';
import type { PlaceId } from '../world/types.ts';

const SECONDS_PER_TICK = 60 * MINUTES_PER_TICK;
/** A need at or under this is the line a walk stops on — the level the game calls "starving". */
const NEED_LINE = 3;

/** One stretch of a walk: across one map, and the place entered at its end. */
type Leg = { map: GameMap; from: Cell; to: Cell; enters: PlaceId | null };

/**
 * Walk the player along a route of places, tile by tile across every hub and
 * field on the way (DESIGN 6c §2, W3), and say where the walk STOPS.
 *
 * It never calls the model. Every tile is charged its seconds; at each tick the
 * clock crosses, it asks what the clock already drives — a traveller arriving, a
 * need falling to its line, night on wild ground — and stops at the first. What
 * it returns is recorded, so the fold replays the walk without any of this.
 * Portals on the way do not stop it; the destination does, on the door of its hub.
 *
 * `route` is the places to enter, in order (`walkRoute`); `mapOf` gives the
 * session's stored copy of each map.
 */
export async function walkAlong(
  state: PlayState,
  route: PlaceId[],
  mapOf: (id: MapId) => GameMap | Promise<GameMap>,
): Promise<WalkTo> {
  const { world } = state;
  const region = activeRegion(world);
  if (!region || route.length === 0) throw new Error('walkAlong: nothing to walk');
  const door = (m: GameMap, to: MapId): Cell => {
    const found = portalsOf(world, m).find((p) => 'to' in p && p.to === to);
    if (!found) throw new Error(`map "${m.id}" has no door to "${to}"`);
    return { x: found.x, y: found.y };
  };
  const hubOf = (p: PlaceId) => mapOf(hubId(region.id, p));
  /** In `p`'s hub, the door onto the field toward `other`. */
  const hubDoor = (hub: GameMap, p: PlaceId, other: PlaceId) => door(hub, fieldId(region.id, p, other));
  /** On a field, the end that opens into `p`'s hub. */
  const fieldEnd = (field: GameMap, p: PlaceId) => door(field, hubId(region.id, p));

  const legs: Leg[] = [];
  const queue = [...route];
  let place = world.currentPlace;
  const start = positionOf(world);
  let hub: GameMap;
  let cell: Cell;

  const ends = fieldEnds(start.map);
  if (ends) {
    // On a field: on to its far end if that is the way, or back to where you left.
    const field = await mapOf(start.map);
    const other = ends[0] === place ? ends[1] : ends[0];
    if (queue[0] === other) {
      legs.push({ map: field, from: start, to: fieldEnd(field, other), enters: queue.shift()! });
      hub = await hubOf(other);
      cell = hubDoor(hub, other, place);
      place = other;
    } else {
      legs.push({ map: field, from: start, to: fieldEnd(field, place), enters: null });
      hub = await hubOf(place);
      cell = hubDoor(hub, place, other);
    }
  } else {
    hub = await hubOf(place);
    if (hub.id !== start.map) throw new Error(`walkAlong: standing on "${start.map}", not at ${place}`);
    cell = { x: start.x, y: start.y };
  }
  for (const next of queue) {
    legs.push({ map: hub, from: cell, to: hubDoor(hub, place, next), enters: null });
    const field = await mapOf(fieldId(region.id, place, next));
    legs.push({ map: field, from: fieldEnd(field, place), to: fieldEnd(field, next), enters: next });
    hub = await hubOf(next);
    cell = hubDoor(hub, next, place);
    place = next;
  }

  const clock0 = clockOf(world);
  const carried = world.second ?? 0;
  const needs0 = state.sheet.needs ?? { food: NEED_MAX, rest: NEED_MAX };
  const kind = new Map(region.places.map((p) => [p.id, p.kind]));

  /** What stops the walk on the tick `t`, standing in `here`'s ground on map `m`. */
  const stopAt = (t: number, m: GameMap, here: PlaceId): Stop | null => {
    const there = { ...world, currentPlace: here };
    const later = { ...advanceJourneys(there, clock0, t), clock: t };
    if (arrivalOpens({ ...state, world: later })) return 'encounter';
    const needs = needsAfter({ ...state, world: there }, clock0, t);
    if (needs0.food > NEED_LINE && needs.food <= NEED_LINE) return 'hungry';
    if (needs0.rest > NEED_LINE && needs.rest <= NEED_LINE) return 'weary';
    const wild = fieldEnds(m.id) !== null || kind.get(here) === 'wild' || kind.get(here) === 'dungeon';
    if (wild && isNight({ ...world, clock: t }) && !isNight({ ...world, clock: t - 1 })) return 'nightfall';
    return null;
  };

  let spent = 0;
  let ticks = 0;
  let here = world.currentPlace;
  const through: PlaceId[] = [];
  for (const leg of legs) {
    const path = bestRoute(leg.map, leg.from, leg.to);
    if (path.length === 0) throw new Error(`walkAlong: no way across "${leg.map.id}"`);
    for (const c of path.slice(1)) {
      spent += tileSeconds(leg.map, c);
      const crossed = Math.floor((carried + spent) / SECONDS_PER_TICK);
      if (crossed === ticks) continue;
      ticks = crossed;
      const stop = stopAt(clock0 + ticks, leg.map, here);
      if (stop) return { map: leg.map.id, x: c.x, y: c.y, seconds: spent, through, stop };
    }
    if (leg.enters) {
      through.push(leg.enters);
      here = leg.enters;
    }
  }
  return { map: hub.id, x: cell.x, y: cell.y, seconds: spent, through, stop: 'arrived' };
}
