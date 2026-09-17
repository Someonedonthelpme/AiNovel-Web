import { compressExcept } from './lod.ts';
import type { Gazetteer, Link, PlaceId, Region, RegionId, World } from './types.ts';
import { isFull, regionIdFor } from './types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { forbids, rulesOf } from '../rules/ruleset.ts';
import type { Subject } from '../rules/ruleset.ts';
import type { Law } from '../rules/ruleset.ts';

/**
 * Movement within and between regions.
 *
 * Travel is where the map does its anti-drift work: you can only go where an
 * edge exists, so the Director is choosing from a finite set rather than
 * inventing somewhere new.
 *
 * Crossing between floors may need a region that does not exist yet, or one
 * that has been compressed. Rather than reach for a generator, these functions
 * return a `needsRegion` request and let the caller — which owns the LLM — do
 * the work. That keeps this module pure and testable offline.
 */

export type TravelResult =
  | { kind: 'moved'; world: World }
  | { kind: 'needsRegion'; floor: number; regionId: RegionId; gazetteer: Gazetteer | null }
  // `law` is present when it was the WORLD that refused rather than the map.
  // Carrying it means the caller can say which rule, and somebody can learn it.
  | { kind: 'error'; reason: string; law?: Law };

export function currentRegion(world: World): Region | Gazetteer | null {
  return world.regions[world.currentRegion] ?? null;
}

/** The full record for the region the player is standing in. */
/**
 * How much TIME it takes to cross between two places (DESIGN 6b stage 7.1a).
 *
 * Seeded on the world and the pair alone, and the same both ways, so the model
 * never decides a distance: it counts and keeps adjacency unreliably, the reason
 * 6c keeps maps out of its hands. Every character pays it, the player included.
 *
 * `ponytail: a flat 1..3 draw. Weight it by what the two places are when 6c
 * draws maps.`
 */
export function linkCost(world: Pick<World, 'seed'>, a: PlaceId, b: PlaceId): number {
  const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
  let hash = (world.seed ^ 0x71a) >>> 0;
  for (const ch of pair) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return 1 + Math.floor(mulberry32(hash)() * 3);
}

/**
 * The world clock: time, separate from the count of play turns. A world stored
 * before it had one reads its turn count, which is what the clock would have
 * been had every turn taken one tick.
 */
export const clockOf = (world: { turn: number; clock?: number }): number => world.clock ?? world.turn;

export function activeRegion(world: World): Region | null {
  const record = currentRegion(world);
  return record && isFull(record) ? record : null;
}

export function currentPlace(world: World) {
  const region = activeRegion(world);
  return region?.places.find((p) => p.id === world.currentPlace) ?? null;
}

/** Places directly connected to where the player stands. */
export function exitsFrom(world: World): PlaceId[] {
  return currentPlace(world)?.connections ?? [];
}

export function moveWithinRegion(world: World, to: PlaceId): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };

  const here = region.places.find((p) => p.id === world.currentPlace);
  if (!here) return { kind: 'error', reason: `current place "${world.currentPlace}" is not in this region` };
  if (to === world.currentPlace) return { kind: 'error', reason: 'already there' };
  if (!here.connections.includes(to)) return { kind: 'error', reason: `no route from "${here.id}" to "${to}"` };

  const target = region.places.find((p) => p.id === to);
  if (!target) return { kind: 'error', reason: `no such place: "${to}"` };

  // Arriving reveals the place — and so does having stood in the one you are
  // leaving, which is what keeps a place you have walked through from being
  // treated as a secret the moment you step out of it.
  const places = region.places.map((p) =>
    p.id === to || p.id === world.currentPlace ? { ...p, discovered: true } : p,
  );
  return {
    kind: 'moved',
    world: {
      ...world,
      currentPlace: to,
      turn: world.turn + 1,
      regions: { ...world.regions, [region.id]: { ...region, places } },
    },
  };
}

function crossTo(world: World, link: Link, arriveAt: (r: Region) => PlaceId | null): TravelResult {
  const { to: regionId, floor } = link;
  const record = world.regions[regionId];

  if (!record) return { kind: 'needsRegion', floor, regionId, gazetteer: null };
  if (!isFull(record)) return { kind: 'needsRegion', floor, regionId, gazetteer: record };

  const landing = arriveAt(record);
  if (!landing) return { kind: 'error', reason: `floor ${floor} has no landing point` };

  // Keep both the region being entered and the one being left in full detail,
  // so stepping up and immediately back down costs nothing.
  const kept = compressExcept(world, [regionId, world.currentRegion], world.turn);

  const target = kept.regions[regionId];
  const places = isFull(target)
    ? target.places.map((p) => (p.id === landing ? { ...p, discovered: true } : p))
    : [];

  return {
    kind: 'moved',
    world: {
      ...kept,
      currentRegion: regionId,
      currentPlace: landing,
      turn: kept.turn + 1,
      deepestFloor: Math.max(kept.deepestFloor, floor),
      regions: isFull(target) ? { ...kept.regions, [regionId]: { ...target, places } } : kept.regions,
    },
  };
}

/** The stair up, as a link. Present whether or not the way up has been found. */
const upFrom = (region: Region): Link =>
  ({ to: regionIdFor(region.floor + 1), via: region.exit ?? region.entrance, floor: region.floor + 1, direction: 'up' });

const downFrom = (region: Region): Link =>
  ({ to: regionIdFor(region.floor - 1), via: region.entrance, floor: region.floor - 1, direction: 'down' });

/**
 * Every way out of a region.
 *
 * A region that names its own `exits` has exactly those. One that does not is a
 * STACK, and its adjacency is derived from depth — which is what every world
 * saved before regions could name their ways out relies on. The way up is
 * listed only once it has been found; the way down is always there to be
 * refused by the law or by the floor of the world.
 */
export function linksFrom(region: Region): Link[] {
  if (region.exits?.length) return region.exits;
  return [...(region.exit === null ? [] : [upFrom(region)]), downFrom(region)];
}

/**
 * Take a named way out of this region.
 *
 * The general form of `ascend` and `descend`: a structure that is not a stack
 * has ways out that are neither up nor down, and this is how they are walked.
 */
export function traverse(world: World, to: RegionId): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };

  const link = linksFrom(region).find((l) => l.to === to);
  if (!link) return { kind: 'error', reason: `there is no way from here to "${to}"` };
  // A stair is climbed, not traversed. The ground law and the world's own floor
  // are checked in `descend`, and a general walk that could reach a derived
  // up/down link would be a way around both.
  if (link.direction) return { kind: 'error', reason: 'that is a stair — climb it' };
  if (world.currentPlace !== link.via) return { kind: 'error', reason: 'you are not at that way out' };

  return crossTo(world, link, (r) => r.entrance);
}

/** Climb to the next floor. Only possible from a discovered way up. */
export function ascend(world: World): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };
  if (region.exit === null) return { kind: 'error', reason: 'the way up has not been found yet' };
  if (world.currentPlace !== region.exit) return { kind: 'error', reason: 'you are not at the way up' };

  return crossTo(world, upFrom(region), (r) => r.entrance);
}

/**
 * Descend to the floor below, arriving at its way up.
 *
 * The subject defaults to a plain `'player'` — bound by every law that names
 * them — so a caller that forgets to say who is asking gets the STRICTEST
 * reading rather than a free pass. An exemption has to be handed in on purpose.
 */
export function descend(world: World, subject: Subject = 'player'): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };
  // The ground being the bottom is this world's LAW, not the engine's assumption:
  // a world without it can be dug into. The subject is passed because whether the
  // player is bound is part of the law — and because one of them may be exempt.
  const groundLaw = region.floor === 0
    ? forbids(world, subject, 'descendBelowGround')
    : null;
  if (groundLaw) {
    return { kind: 'error', reason: 'you are already at ground level', law: groundLaw };
  }
  // Permission and geography are different questions, and the law only answers
  // the first. Without this a world that permits digging has no bottom at all,
  // and every floor down is a generation call.
  if (region.floor - 1 < -rulesOf(world).world.depthBelowGround) {
    return { kind: 'error', reason: 'there is nothing below this but solid ground' };
  }
  if (world.currentPlace !== region.entrance) return { kind: 'error', reason: 'you are not at the way down' };

  return crossTo(world, downFrom(region), (r) => r.exit ?? r.entrance);
}

/** Record a newly generated or rehydrated region and step into it. */
export function installRegion(world: World, region: Region, arriveAt: PlaceId): World {
  const withRegion: World = { ...world, regions: { ...world.regions, [region.id]: region } };
  const result = crossTo(withRegion, { to: region.id, via: arriveAt, floor: region.floor }, (r) =>
    r.places.some((p) => p.id === arriveAt) ? arriveAt : r.entrance,
  );
  return result.kind === 'moved' ? result.world : withRegion;
}
