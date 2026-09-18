import { dangerFor } from './budget.ts';
import { rulesOf } from '../rules/ruleset.ts';
import type { Stratum, World } from './types.ts';

/**
 * Which stratum speaks for a floor.
 *
 * The INNERMOST one containing it: a dungeon inside a tower is still the
 * dungeon. Depth is the length of the parent chain, so nesting is what decides,
 * not declaration order — a world's strata are a tree and this is the walk down
 * it. Null when a world declares none, or none covers this floor.
 */
export function stratumAt(world: World, floor: number): Stratum | null {
  const strata = world.strata;
  if (!strata) return null;

  const depthOf = (s: Stratum): number => {
    let depth = 0;
    let at: Stratum | undefined = s;
    // Bounded by the number of strata, so a parent cycle cannot hang the fold.
    while (at?.parent && depth <= Object.keys(strata).length) {
      at = strata[at.parent];
      depth += 1;
    }
    return depth;
  };

  let best: Stratum | null = null;
  let bestDepth = -1;
  // Sorted, because two strata at the same depth covering one floor is an
  // authoring mistake and a fold must resolve it identically every time.
  for (const s of Object.values(strata).sort((a, b) => a.id.localeCompare(b.id))) {
    if (floor < s.from || (s.to !== undefined && floor > s.to)) continue;
    const depth = depthOf(s);
    if (depth > bestDepth) {
      best = s;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * How dangerous a floor is, asking the stratum before the dials.
 *
 * A curve inherits UP the tree — a dungeon that sets none is as dangerous as
 * the tower around it — and falls back to the world's ruleset when no stratum
 * covers the floor. This is what "danger curve decoupled from depth" means in
 * practice: a quiet band deep in a tower, or a brutal early wing.
 */
export function dangerAt(world: World, floor: number): number {
  let at = stratumAt(world, floor);
  const strata = world.strata ?? {};

  for (let hops = 0; at && hops <= Object.keys(strata).length; hops += 1) {
    if (at.danger) return Math.max(0, Math.round(at.danger.base + floor * at.danger.perFloor));
    at = at.parent ? strata[at.parent] ?? null : null;
  }
  return dangerFor(floor, rulesOf(world));
}

/** Whether this floor LOOPS: put back as it was built whenever it is left uncleared (DESIGN 6c). */
export const isLoop = (world: World, floor: number): boolean =>
  stratumAt(world, floor)?.laws?.reset === 'untilCleared';

/** Whether this floor's stratum is frozen: authored once, never rebuilt. */
export const isStatic = (world: World, floor: number): boolean =>
  stratumAt(world, floor)?.kind === 'static';
