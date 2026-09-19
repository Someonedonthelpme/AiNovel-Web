import type { PlayState } from '../play/state.ts';
import { positionOf } from '../world/map.ts';
import type { GameMap } from '../world/map.ts';
import { layoutRegion, mapEdges } from '../world/layout.ts';
import { activeRegion } from '../world/travel.ts';
import { heldByPlayer } from '../world/holding.ts';
import { dateOf } from '../world/calendar.ts';
import { lawFrom } from '../world/strata.ts';
import { isFull } from '../world/types.ts';

/*
 * The side column (DESIGN 6c §2, W4b): information, never a control. Nothing
 * here moves the player — walking is the centre grid's.
 */

/** The minimap's widest, in cells. */
const MINI = 60;

export type MinimapView = { rows: string[]; you: { x: number; y: number } };
export type FloorMapView = {
  nodes: { id: string; name: string; kind: string; current: boolean; x: number; y: number }[];
  edges: { from: string; to: string }[];
};
export type TowerView = {
  strata: { id: string; name: string; from: number; to: number | null }[];
  floors: { floor: number; name: string; era: boolean; year: number }[];
  held: string[];
  deepest: number;
  grudges: { name: string }[];
};

/**
 * The whole map you stand on, shrunk by a whole factor to at most 60 cells
 * wide. A cell shows the best ground in its block, so a narrow road through
 * rough country still reads as a road.
 */
export function minimapOf(state: PlayState, map: GameMap): MinimapView {
  const w = map.rows[0]?.length ?? 0;
  const f = Math.max(1, Math.ceil(w / MINI));
  const rows: string[] = [];
  for (let y = 0; y < map.rows.length; y += f) {
    let row = '';
    for (let x = 0; x < w; x += f) {
      const block = map.rows.slice(y, y + f).map((r) => r.slice(x, x + f)).join('');
      row += block.includes('.') ? '.' : block.includes(',') ? ',' : '#';
    }
    rows.push(row);
  }
  const you = positionOf(state.world);
  return { rows, you: { x: Math.floor(you.x / f), y: Math.floor(you.y / f) } };
}

/**
 * The floor's places, DISCOVERED ONLY (and where you stand), and the roads
 * between them. A place you have not reached is not on it at all — the centre
 * grid's doors are how you learn a road leads somewhere.
 */
export function floorMapOf(state: PlayState): FloorMapView {
  const region = activeRegion(state.world);
  if (!region) return { nodes: [], edges: [] };
  const shown = new Set(region.places.filter((p) => p.discovered || p.id === state.world.currentPlace).map((p) => p.id));
  const at = new Map(layoutRegion(region).map((p) => [p.id, p]));
  return {
    nodes: region.places.filter((p) => shown.has(p.id)).map((p) => ({
      id: p.id, name: p.name, kind: p.kind, current: p.id === state.world.currentPlace,
      x: at.get(p.id)?.x ?? 50, y: at.get(p.id)?.y ?? 50,
    })),
    edges: mapEdges(region).filter((e) => shown.has(e.from) && shown.has(e.to)),
  };
}

/**
 * The tower as you know it: its strata, every floor the world holds with the
 * year it stands in, what you hold, how deep you have been, and grudges on the
 * road — only of people you have MET, and never where they are (invariant 5).
 */
export function towerOf(state: PlayState): TowerView {
  const { world } = state;
  const floors = Object.values(world.regions)
    .map((r) => ({ floor: r.floor, name: r.name, era: lawFrom(world, r.floor, 'time')?.laws?.time === 'era', year: dateOf(world, undefined, r.floor).year }))
    .sort((a, b) => a.floor - b.floor);
  const held = Object.values(world.regions).flatMap((r) => (isFull(r) ? r.places.filter(heldByPlayer).map((p) => p.name) : []));
  const met = (id: string) => (world.people[id]?.lastSeenTurn ?? 0) > 0;
  const grudges = [...new Set((world.journeys ?? []).map((j) => j.who))]
    .filter(met)
    .sort()
    .map((id) => ({ name: world.people[id].name }));
  return {
    strata: Object.values(world.strata ?? {}).map((s) => ({ id: s.id, name: s.name, from: s.from, to: s.to ?? null })),
    floors,
    held,
    deepest: world.deepestFloor,
    grudges,
  };
}
