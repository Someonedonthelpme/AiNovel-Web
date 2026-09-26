import type { PlayState } from '../play/state.ts';
import { fieldEnds, portalsOf, positionOf } from '../world/map.ts';
import type { GameMap } from '../world/map.ts';
import { activeRegion, signposted } from '../world/travel.ts';
import { regionIdFor } from '../world/types.ts';

/** The centre view's window, in tiles: about a screen of ground around you. */
const WIDE = 41;
const TALL = 25;

export type GridView = {
  map: string;
  /** The window's top-left tile on the map; `rows` are the map's own tiles from there. */
  x0: number; y0: number; rows: string[];
  you: { x: number; y: number };
  /**
   * EVERY door on the map, not just those in the window: a field runs for
   * hundreds of tiles, and its far end is a button before it is ever in view.
   * `label` is a place's name only when you could know it (invariant 5).
   */
  doors: { x: number; y: number; to: string | null; stair: 'up' | 'down' | null; label: string | null }[];
};

/**
 * The centre view (W4a): a window of the map you stand on, and its doors. Pure;
 * the caller hands in the map, which is the session's stored copy.
 */
export function gridOf(state: PlayState, map: GameMap): GridView {
  const { world } = state;
  const you = positionOf(world);
  const w = map.rows[0]?.length ?? 0;
  const h = map.rows.length;
  const clip = (at: number, size: number, window: number) => Math.max(0, Math.min(at - Math.floor(window / 2), size - window));
  const x0 = clip(you.x, w, WIDE);
  const y0 = clip(you.y, h, TALL);
  const rows = map.rows.slice(y0, y0 + TALL).map((r) => r.slice(x0, x0 + WIDE));

  const region = activeRegion(world);
  const places = region?.places ?? [];
  const known = signposted(region, world.currentPlace);
  const nameOf = (id: string) => {
    const p = places.find((q) => q.id === id);
    return p && (known.has(p.id) || p.discovered || p.id === world.currentPlace) ? p.name : null;
  };
  const ends = fieldEnds(map.id);
  const doors = portalsOf(world, map).map((d) => {
    if ('region' in d) {
      const stair = region && d.region === regionIdFor(region.floor + 1) ? 'up' as const
        : region && d.region === regionIdFor(region.floor - 1) ? 'down' as const : null;
      return { x: d.x, y: d.y, to: null, stair, label: null };
    }
    // A hub's door leads onto the field toward the OTHER place; a field's end, into its own.
    const toward = ends
      ? ends.find((p) => d.to.endsWith(`:${p}`)) ?? null
      : (fieldEnds(d.to) ?? []).find((p) => p !== world.currentPlace) ?? null;
    return { x: d.x, y: d.y, to: d.to, stair: null, label: toward ? nameOf(toward) : null };
  });
  return { map: map.id, x0, y0, rows, you: { x: you.x, y: you.y }, doors };
}
