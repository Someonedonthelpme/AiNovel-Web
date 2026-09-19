import { mulberry32 } from '../engine/roll.ts';
import { activeRegion, linkMinutes, pairDraw } from './travel.ts';
import type { PlaceId, Region, World } from './types.ts';

export type Cell = { x: number; y: number };
/** A link's route: `seconds` to walk, one tile a second on open ground, and its tiles end to end. */
export type Route = { seconds: number; path: Cell[] };

/**
 * The route a link's field map is drawn around (DESIGN 6c §2, W1): its best path
 * costs exactly the link's time, so a journey that never walks tiles and a player
 * who does pay the same. Dealt from the seed and the pair, the same both ways, and
 * blind to the season — it becomes a stored map.
 *
 * Its shape: vertical legs, alternately up and down, joined by two diagonal steps
 * over a one-tile column. No two tiles more than one step apart along it are
 * neighbours (eight ways, combat's grid), so nothing on it cuts a corner. The ends
 * lie a third to two thirds of the route apart; the rest is the winding W2 walls in.
 */
export function routeOf(world: World, a: PlaceId, b: PlaceId, region: Region | null = activeRegion(world)): Route {
  if (!region?.places.find((p) => p.id === a)?.connections.includes(b)) {
    throw new Error(`no link between "${a}" and "${b}" in ${region?.id ?? 'no loaded region'}`);
  }
  const seconds = 60 * linkMinutes(world, a, b, region);
  const rng = mulberry32(Math.floor(pairDraw(world.seed, 0x40a7e, a, b) * 2 ** 32));
  const lo = Math.ceil(seconds / 6), hi = Math.floor(seconds / 3);
  const turns = lo + Math.floor(rng() * (hi - lo + 1));

  // The slack past the straight line, shared unevenly across the legs.
  const weights = Array.from({ length: turns + 1 }, () => rng());
  const total = weights.reduce((s, w) => s + w, 0);
  const slack = seconds - 2 * turns;
  const legs = weights.map((w) => Math.floor((slack * w) / total));
  for (let i = 0, left = slack - legs.reduce((s, h) => s + h, 0); left > 0; i++, left--) legs[i % legs.length]++;

  const path: Cell[] = [{ x: 0, y: 0 }];
  const step = (dx: number, dy: number) => { const at = path[path.length - 1]; path.push({ x: at.x + dx, y: at.y + dy }); };
  legs.forEach((h, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    for (let k = 0; k < h; k++) step(0, dir);
    if (i < turns) { step(1, dir); step(1, -dir); }
  });
  return { seconds, path: a < b ? path : path.reverse() };
}
