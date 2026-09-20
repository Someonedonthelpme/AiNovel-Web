import { hasLineOfSight } from '../combat/grid.ts';
import type { Grid } from '../combat/types.ts';
import { drawMap, fieldEnds, positionOf } from '../world/map.ts';
import type { Cell, GameMap, MapId } from '../world/map.ts';
import { routeOf } from '../world/route.ts';
import { activeRegion, travelTime } from '../world/travel.ts';
import { isFull } from '../world/types.ts';
import type { Person, World } from '../world/types.ts';
import { populationAt } from '../character/population.ts';
import type { Cohort } from '../character/population.ts';
import { nextHopOf } from './journey.ts';
import { journeysOf } from './journey.ts';
import type { PlayState } from './state.ts';

/**
 * Who is out on the road with you (DESIGN 6c §2, W5).
 *
 * A journey between two places is a FIGURE on that link's field, as far along
 * as the traveller has come. Nothing here is folded: the fold holds no tiles,
 * so a walk RECORDS who came into view (`WalkTo.met`) and replays from that.
 */

/** How far you can see on open ground, in tiles. */
export const VIEW = 12;

export type Figure = { who: string; x: number; y: number };
/** A traveller crossing one field: the tiles they walk, and how far along they are. */
export type Rider = { who: string; path: Cell[]; cost: number; progress: number };

/** The walls of a map, as the combat grid reads them. */
export function gridOfMap(m: GameMap): Grid {
  const walls = new Set<string>();
  m.rows.forEach((row, y) => [...row].forEach((tile, x) => { if (tile === '#') walls.add(`${x},${y}`); }));
  return { width: m.rows[0]?.length ?? 0, height: m.rows.length, walls };
}

/** Whether one tile can see another: twelve tiles of open ground, and nothing in the way. */
export function inView(m: GameMap, from: Cell, to: Cell): boolean {
  if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) > VIEW) return false;
  return hasLineOfSight(gridOfMap(m), from, to);
}

/**
 * Everybody crossing this field, with the ground they are walking.
 *
 * Kept apart from `figuresOn` because a WALK asks between ticks: a traveller
 * crosses a two-tick link while the player is halfway over the same field, so
 * sampling only on the tick would miss them passing each other entirely.
 */
export function ridersOn(world: World, map: MapId): Rider[] {
  const ends = fieldEnds(map);
  const region = ends ? world.regions[map.slice(map.indexOf(':') + 1, map.lastIndexOf(':'))] : null;
  if (!ends || !region || !isFull(region)) return [];
  const riders: Rider[] = [];
  for (const j of journeysOf(world)) {
    if (j.region !== region.id || !j.place || !ends.includes(j.place)) continue;
    const toward = ends.find((p) => p !== j.place)!;
    if (nextHopOf(world, j)?.to.place !== toward) continue;
    riders.push({ who: j.who, path: routeOf(world, j.place, toward, region).path, cost: travelTime(world, j.place, toward, region), progress: j.progress });
  }
  return riders;
}

/** Where a traveller stands after `ticks` more of the clock; null once they are off the field. */
export function riderAt(r: Rider, ticks: number): Cell | null {
  const part = (r.progress + ticks) / r.cost;
  return part >= 1 ? null : r.path[Math.floor((r.path.length - 1) * Math.max(0, part))] ?? null;
}

/**
 * Everybody crossing this field right now, and where they have got to.
 *
 * Somebody standing in a place is not on its roads — only a journey with time
 * already spent on the link it is crossing puts a figure on the ground.
 */
export function figuresOn(world: World, map: MapId): Figure[] {
  const ends = fieldEnds(map);
  const region = ends ? world.regions[map.slice(map.indexOf(':') + 1, map.lastIndexOf(':'))] : null;
  if (!ends || !region || !isFull(region)) return [];
  return ridersOn(world, map).flatMap((r) => {
    // Standing in a place is not being on its roads: only time already spent is.
    if (r.progress <= 0) return [];
    const at = riderAt(r, 0);
    return at ? [{ who: r.who, x: at.x, y: at.y }] : [];
  });
}

/**
 * The crowd where you stand: a place's own, or — out on a field — BOTH ends'
 * (W5). A road between a town and the wild carries some of each, and what lives
 * at either end is what you meet halfway. Tile-free: the fold opens fights too.
 */
export function crowdAround(world: World, floor: number): Cohort[] | null {
  const ends = fieldEnds(positionOf(world).map);
  if (!ends) return populationAt(world, world.currentRegion, world.currentPlace, floor);
  const both = ends.flatMap((p) => populationAt(world, world.currentRegion, p, floor) ?? []);
  return both.length ? both : null;
}

/**
 * Who is with you: on a field, whoever is in VIEW on it — not the residents of
 * the place you set out from, who are a road away. Standing in a place, its
 * people, as before. A view-level question: it reads the map.
 */
export function peopleHere(state: PlayState): Person[] {
  const { world } = state;
  const at = positionOf(world);
  if (!fieldEnds(at.map)) {
    const place = activeRegion(world)?.places.find((p) => p.id === world.currentPlace);
    return (place?.people ?? []).map((id) => world.people[id]).filter(Boolean);
  }
  const map = drawMap(world, at.map);
  return figuresOn(world, at.map)
    .filter((f) => inView(map, at, f))
    .map((f) => world.people[f.who])
    .filter(Boolean);
}
