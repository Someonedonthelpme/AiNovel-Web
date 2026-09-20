import { ARENA_SIZE } from './combat.ts';
import type { Cell, GameMap } from '../world/map.ts';
import type { Grid } from '../combat/types.ts';

/**
 * The ground a fight happens on (DESIGN 6c §2, W7): a window of the map you are
 * standing on, and where it was cut from.
 *
 * Recorded with the fight, never re-cut: the fold holds no tiles, and a board
 * rebuilt from a map that had since changed would replay a different fight.
 */
export type Arena = { x0: number; y0: number; rows: string[] };

/** A square of ground around `at`, shifted to stay inside the map rather than shrunk. */
export function arenaAt(m: GameMap, at: Cell): Arena {
  const w = m.rows[0]?.length ?? 0;
  const clip = (v: number, size: number) => Math.max(0, Math.min(v - Math.floor(ARENA_SIZE / 2), size - ARENA_SIZE));
  const x0 = clip(at.x, w);
  const y0 = clip(at.y, m.rows.length);
  return { x0, y0, rows: m.rows.slice(y0, y0 + ARENA_SIZE).map((r) => r.slice(x0, x0 + ARENA_SIZE)) };
}

/** The same ground as the combat grid reads it: walls block, rough costs double. */
export function gridOfArena(a: Arena): Grid {
  const walls = new Set<string>();
  const rough = new Set<string>();
  a.rows.forEach((row, y) => [...row].forEach((tile, x) => {
    if (tile === '#') walls.add(`${x},${y}`);
    else if (tile === ',') rough.add(`${x},${y}`);
  }));
  return { width: a.rows[0]?.length ?? 0, height: a.rows.length, walls, rough };
}

/** Where you stand, in the arena's own squares. */
export const inArena = (a: Arena, at: Cell): Cell => ({ x: at.x - a.x0, y: at.y - a.y0 });
