import { activeRegion, linkMinutes } from './travel.ts';
import { bestRoute, drawMap, fieldId } from './map.ts';
import type { Cell } from './map.ts';
import type { PlaceId, Region, World } from './types.ts';

export type { Cell };
/** A link's route: `seconds` to walk, one tile a second, and its tiles end to end. */
export type Route = { seconds: number; path: Cell[] };

/**
 * The best path across a link's FIELD map (DESIGN 6c §2, W1 and W2): it costs
 * exactly the link's time, so a journey that never walks tiles and a player who
 * does pay the same. Dealt from the seed and the pair, the same both ways — always
 * searched from the lower id's end and reversed, so ties break alike — and blind
 * to the season, since the field it crosses is stored.
 */
export function routeOf(world: World, a: PlaceId, b: PlaceId, region: Region | null = activeRegion(world)): Route {
  if (!region?.places.find((p) => p.id === a)?.connections.includes(b)) {
    throw new Error(`no link between "${a}" and "${b}" in ${region?.id ?? 'no loaded region'}`);
  }
  const field = drawMap({ ...world, regions: { ...world.regions, [region.id]: region } }, fieldId(region.id, a, b));
  const path = bestRoute(field, field.ends![0], field.ends![1]);
  return { seconds: 60 * linkMinutes(world, a, b, region), path: a < b ? path : path.reverse() };
}
