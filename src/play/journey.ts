import { groupOf, speciesIdFor } from '../character/species.ts';
import { forbids } from '../rules/ruleset.ts';
import { axisOf, hostileToward, PLAYER } from '../social/edge.ts';
import { clockOf, linkCost } from '../world/travel.ts';
import { isFull, regionIdFor } from '../world/types.ts';
import type { PersonId, PlaceId, Region, RegionId, World } from '../world/types.ts';

/**
 * Somebody on the road because of a grudge (DESIGN 6b stage 7.1).
 *
 * A grudge no longer drops its bearer into the player's next fight: it SENDS
 * somebody, who travels on the world clock, and arriving is what opens the fight.
 * Stored, because where a traveller has got to is state a replay must reach
 * again, and advanced only by the fold.
 */
export type Journey = {
  /** Who is travelling. */
  who: PersonId;
  /** Whose grudge sent them. Themselves, until 7.1d lets a bearer send others. */
  for: PersonId;
  region: RegionId;
  /** Where in it. Null while crossing a region that is not loaded in full. */
  place: PlaceId | null;
  /** Ticks already spent on the link they are crossing. */
  progress: number;
  /** The clock tick they may set out. Later than the grudge for someone still recovering. */
  departs: number;
};

/** How long somebody who fled needs before they can set out again. */
export const RECOVERY = 10;

export const journeysOf = (world: Pick<World, 'journeys'>): Journey[] => world.journeys ?? [];

type Spot = { region: RegionId; place: PlaceId | null };

/** Where somebody is: the first loaded place that lists them, else their home region. */
export function whereIs(world: World, id: PersonId): Spot {
  for (const region of [world.regions[world.currentRegion], ...Object.values(world.regions)]) {
    if (!region || !isFull(region)) continue;
    const at = region.places.find((p) => p.people.includes(id));
    if (at) return { region: region.id, place: at.id };
  }
  return { region: world.people[id]?.homeRegion ?? world.currentRegion, place: null };
}

/**
 * Travellers standing where the player stands, and on their way. Somebody still
 * recovering has not set out, even if they are standing right there.
 */
export const arrivedHere = (world: World): Journey[] =>
  journeysOf(world).filter(
    (j) => j.departs <= clockOf(world) && j.region === world.currentRegion && j.place === world.currentPlace,
  );

/**
 * A grudge SETS OUT on the turn it is fed (7.1b): resentment toward the player
 * rose this turn and is hostile, and none of the bearer's parties is on the road
 * already. So after a fight, only a new grievance sends them again. Someone who
 * fled this turn recovers first, or they would strike the turn after fleeing.
 */
export function setOut(before: World, after: World, recovering: readonly PersonId[]): World {
  const busy = new Set(journeysOf(after).map((j) => j.for));
  const resentment = (w: World, id: PersonId) => axisOf(w.edges, id, PLAYER, 'resentment');
  const departing = Object.values(after.people)
    .filter((p) => p.alive && !busy.has(p.id) && hostileToward(after.edges, p.id))
    .filter((p) => resentment(after, p.id) > resentment(before, p.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p): Journey => ({
      who: p.id,
      for: p.id,
      ...whereIs(after, p.id),
      progress: 0,
      departs: clockOf(after) + (recovering.includes(p.id) ? RECOVERY : 0),
    }));
  return departing.length ? { ...after, journeys: [...journeysOf(after), ...departing] } : after;
}

/**
 * Walk every traveller toward the player for the time between two clock ticks.
 *
 * They head for where the player IS; 7.1c replaces that with where they last
 * heard the player was. A link is paid for in full before it is crossed, and
 * time left over is carried as progress on the next one.
 */
export function advanceJourneys(world: World, from: number, to: number): World {
  const journeys = journeysOf(world);
  if (journeys.length === 0 || to <= from) return world;
  const target: Spot = { region: world.currentRegion, place: world.currentPlace };
  return { ...world, journeys: journeys.map((j) => walk(world, j, target, to - Math.max(from, j.departs))) };
}

function walk(world: World, journey: Journey, target: Spot, budget: number): Journey {
  let at = journey;
  let left = budget;
  // Bounded, so a graph the engine cannot resolve can never spin.
  for (let guard = 0; left > 0 && guard < 64; guard++) {
    const hop = nextHop(world, at, target);
    if (!hop) break;
    const need = hop.cost - at.progress;
    if (left < need) return { ...at, progress: at.progress + left };
    left -= need;
    at = { ...at, ...hop.to, progress: 0 };
  }
  return at;
}

/**
 * One step toward the target, and what it costs.
 *
 * Inside the target's region they walk its places by the cheapest route — but
 * where fighting is refused they come no further than its entrance, the gate.
 * Between regions they take a stair one floor at a time, and only where
 * `crossFloors` lets them. A region that is not loaded is crossed in one link.
 *
 * `ponytail: towers only — a sideways region (the outer world) is not walked yet;
 * add region adjacency when the outer world is built.`
 */
function nextHop(world: World, j: Journey, target: Spot): { to: Spot; cost: number } | null {
  if (j.region === target.region) {
    const region = world.regions[j.region];
    if (!region || !isFull(region)) return null;
    if (j.place === null) return { to: { region: region.id, place: region.entrance }, cost: 0 };
    const goal = region.danger === 0 ? region.entrance : target.place;
    if (!goal || j.place === goal) return null;
    const step = firstStep(world, region, j.place, goal);
    return step ? { to: { region: region.id, place: step }, cost: linkCost(world, j.place, step) } : null;
  }

  const here = floorOf(world, j.region);
  const there = floorOf(world, target.region);
  if (here === null || there === null || here === there) return null;
  if (forbids(world, { kind: 'resident', ...groupFor(world, j.who) }, 'crossFloors')) return null;

  const next = here < there ? here + 1 : here - 1;
  const nextId = next === there ? target.region : regionIdFor(next);
  const nextRegion = world.regions[nextId];
  return {
    to: { region: nextId, place: nextRegion && isFull(nextRegion) ? nextRegion.entrance : null },
    cost: linkCost(world, j.region, nextId),
  };
}

/** Which group a traveller is, for a law that binds one. */
function groupFor(world: World, id: PersonId): { group?: string } {
  const kinds = world.species ?? [];
  const person = world.people[id];
  const species = person?.species ?? person?.sheet?.species ?? speciesIdFor(world.seed, id, kinds);
  const group = groupOf(kinds, species);
  return group ? { group } : {};
}

function floorOf(world: World, id: RegionId): number | null {
  const stored = world.regions[id]?.floor;
  if (stored !== undefined) return stored;
  const named = /^floor-(-?\d+)$/.exec(id);
  return named ? Number(named[1]) : null;
}

/** The first place on the cheapest route, ties broken by id so a replay walks the same way. */
function firstStep(world: World, region: Region, from: PlaceId, goal: PlaceId): PlaceId | null {
  const cost = new Map<PlaceId, number>([[from, 0]]);
  const via = new Map<PlaceId, PlaceId>();
  const done = new Set<PlaceId>();
  for (;;) {
    let at: PlaceId | null = null;
    for (const [p, c] of cost) {
      if (done.has(p)) continue;
      if (at === null || c < cost.get(at)! || (c === cost.get(at) && p < at)) at = p;
    }
    if (at === null) return null;
    if (at === goal) return via.get(at) ?? null;
    done.add(at);
    for (const next of region.places.find((p) => p.id === at)?.connections ?? []) {
      const c = cost.get(at)! + linkCost(world, at, next);
      if (!cost.has(next) || c < cost.get(next)!) {
        cost.set(next, c);
        via.set(next, at === from ? next : via.get(at)!);
      }
    }
  }
}
