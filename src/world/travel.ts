import { compressExcept } from './lod.ts';
import type { Gazetteer, PlaceId, Region, RegionId, World } from './types.ts';
import { isFull, regionIdFor } from './types.ts';
import { forbids } from '../rules/ruleset.ts';
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

function crossTo(world: World, floor: number, arriveAt: (r: Region) => PlaceId | null): TravelResult {
  const regionId = regionIdFor(floor);
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

/** Climb to the next floor. Only possible from a discovered way up. */
export function ascend(world: World): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };
  if (region.exit === null) return { kind: 'error', reason: 'the way up has not been found yet' };
  if (world.currentPlace !== region.exit) return { kind: 'error', reason: 'you are not at the way up' };

  return crossTo(world, region.floor + 1, (r) => r.entrance);
}

/** Descend to the floor below, arriving at its way up. */
export function descend(world: World): TravelResult {
  const region = activeRegion(world);
  if (!region) return { kind: 'error', reason: 'the current region is not loaded in full detail' };
  // The ground being the bottom is this world's LAW, not the engine's assumption:
  // a world without it can be dug into. The subject is passed because whether the
  // player is bound is part of the law.
  const groundLaw = region.floor === 0
    ? forbids(world, 'player', 'descendBelowGround')
    : null;
  if (groundLaw) {
    return { kind: 'error', reason: 'you are already at ground level', law: groundLaw };
  }
  if (world.currentPlace !== region.entrance) return { kind: 'error', reason: 'you are not at the way down' };

  return crossTo(world, region.floor - 1, (r) => r.exit ?? r.entrance);
}

/** Record a newly generated or rehydrated region and step into it. */
export function installRegion(world: World, region: Region, arriveAt: PlaceId): World {
  const withRegion: World = { ...world, regions: { ...world.regions, [region.id]: region } };
  const result = crossTo(withRegion, region.floor, (r) =>
    r.places.some((p) => p.id === arriveAt) ? arriveAt : r.entrance,
  );
  return result.kind === 'moved' ? result.world : withRegion;
}
