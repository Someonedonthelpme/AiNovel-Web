import { dangerFor } from './budget.ts';
import { hashText, mulberry32 } from '../engine/roll.ts';
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
export function stratumAt(world: Pick<World, 'strata'>, floor: number): Stratum | null {
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

/**
 * The stratum that speaks for one LAW on this floor: the innermost that states it.
 *
 * Laws INHERIT, like danger: a wing the model opens inside a band is still in
 * the band. Reading only the innermost stratum let a wing inside the loop band
 * quietly stop its floors looping (DESIGN 6c era E3a). A law the wing states
 * itself still wins.
 */
export function lawFrom(world: Pick<World, 'strata'>, floor: number, law: keyof NonNullable<Stratum['laws']>): Stratum | null {
  const strata = world.strata ?? {};
  let at = stratumAt(world, floor);
  for (let hops = 0; at && hops <= Object.keys(strata).length; hops += 1) {
    if (at.laws?.[law] !== undefined) return at;
    at = at.parent ? strata[at.parent] ?? null : null;
  }
  return null;
}

/** Whether this floor LOOPS: put back as it was built whenever it is left uncleared (DESIGN 6c). */
export const isLoop = (world: World, floor: number): boolean =>
  lawFrom(world, floor, 'reset')?.laws?.reset === 'untilCleared';

/** Whether this floor's stratum is frozen: authored once, never rebuilt. */
export const isStatic = (world: World, floor: number): boolean =>
  stratumAt(world, floor)?.kind === 'static';

/** How many years apart two neighbouring era floors are, dealt per floor. */
export const ERA_GAP = { min: 10, max: 100 } as const;

/**
 * How many years this floor's era is from the world's own year (DESIGN 6c).
 *
 * Eras run from the past toward the present going UP the stratum, so a deed on
 * a lower floor is older than what a higher floor remembers of it; the top
 * floor is still one gap in the past. Whole years only, so the hour, the season
 * and the night stay the world's. Dealt from the seed, never stored.
 */
export function eraOf(world: Pick<World, 'strata' | 'seed'>, floor: number): number {
  const at = lawFrom(world, floor, 'time');
  if (at?.laws?.time !== 'era') return 0;
  // Eras count down from the top floor, so an open-ended stratum has none to
  // count from. Refused loudly: quietly keeping the world clock would read as a
  // working era band that simply never changes the year.
  if (at.to === undefined) throw new Error(`era stratum "${at.id}" has no top floor (\`to\`), so its eras cannot be counted`);
  let years = 0;
  for (let f = floor; f <= at.to; f += 1) {
    const rng = mulberry32((world.seed ^ hashText(`${at.id}|era|${f}`)) >>> 0);
    years += ERA_GAP.min + Math.floor(rng() * (ERA_GAP.max - ERA_GAP.min + 1));
  }
  return -years;
}
