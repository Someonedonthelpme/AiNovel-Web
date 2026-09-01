import type { Combatant, Grid, Vec } from './types.ts';

export const cellKey = (v: Vec): string => `${v.x},${v.y}`;

export const sameCell = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;

/**
 * Chebyshev distance: diagonals cost the same as orthogonals, which is the
 * simplified 5e movement rule and keeps range arithmetic predictable.
 */
export function distance(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function inBounds(grid: Grid, v: Vec): boolean {
  return v.x >= 0 && v.y >= 0 && v.x < grid.width && v.y < grid.height;
}

export function isWall(grid: Grid, v: Vec): boolean {
  return grid.walls.has(cellKey(v));
}

export function passable(grid: Grid, v: Vec): boolean {
  return inBounds(grid, v) && !isWall(grid, v);
}

/**
 * Supercover line between two cells — every cell the line touches, so a wall on
 * a diagonal seam still blocks sight rather than leaking through the corner.
 */
export function lineCells(a: Vec, b: Vec): Vec[] {
  const cells: Vec[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  cells.push({ x, y });
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 > -dy && (x !== b.x)) {
      err -= dy;
      x += sx;
    } else if (e2 < dx && y !== b.y) {
      err += dx;
      y += sy;
    } else if (x !== b.x) {
      err -= dy;
      x += sx;
    } else {
      err += dx;
      y += sy;
    }
    cells.push({ x, y });
  }
  return cells;
}

/** Walls between the two cells block sight; the endpoints themselves do not. */
export function hasLineOfSight(grid: Grid, a: Vec, b: Vec): boolean {
  const cells = lineCells(a, b);
  for (let i = 1; i < cells.length - 1; i++) {
    if (isWall(grid, cells[i])) return false;
  }
  return true;
}

const NEIGHBOURS: Vec[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export type Occupancy = { blocksPassage: (at: Vec) => boolean; occupied: (at: Vec) => boolean };

/**
 * Build occupancy rules from the current combatants: you may move THROUGH an
 * ally but never through an enemy, and you may not END your move sharing a
 * square with anyone.
 */
export function occupancyFor(combatants: Combatant[], moverSide: string): Occupancy {
  const living = combatants.filter((c) => !c.dead);
  const byCell = new Map<string, Combatant>();
  for (const c of living) byCell.set(cellKey(c.pos), c);
  return {
    blocksPassage: (at) => {
      const c = byCell.get(cellKey(at));
      return c !== undefined && c.side !== moverSide;
    },
    occupied: (at) => byCell.has(cellKey(at)),
  };
}

/**
 * Every square reachable within `budget` movement, with its cost. Breadth-first
 * because every step costs exactly 1.
 */
export function reachable(grid: Grid, from: Vec, budget: number, occ: Occupancy): Map<string, number> {
  const costs = new Map<string, number>([[cellKey(from), 0]]);
  let frontier: Vec[] = [from];

  for (let step = 1; step <= budget; step++) {
    const next: Vec[] = [];
    for (const cell of frontier) {
      for (const d of NEIGHBOURS) {
        const to = { x: cell.x + d.x, y: cell.y + d.y };
        const key = cellKey(to);
        if (costs.has(key)) continue;
        if (!passable(grid, to)) continue;
        if (occ.blocksPassage(to)) continue;
        costs.set(key, step);
        next.push(to);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  costs.delete(cellKey(from));
  return costs;
}

/** Squares you could actually stop on. */
export function reachableStops(grid: Grid, from: Vec, budget: number, occ: Occupancy): Map<string, number> {
  const all = reachable(grid, from, budget, occ);
  for (const key of [...all.keys()]) {
    const [x, y] = key.split(',').map(Number);
    if (occ.occupied({ x, y })) all.delete(key);
  }
  return all;
}
