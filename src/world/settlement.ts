import { mulberry32 } from '../engine/roll.ts';
import { holderOf } from './holding.ts';
import { drawMap, hubId, portalsOf } from './map.ts';
import type { Cell } from './map.ts';
import { pairDraw } from './travel.ts';
import { isFull } from './types.ts';
import type { Place, PlaceId, RegionId, World } from './types.ts';
import type { Building } from './workstation.ts';
import { modulesNeeded } from './building.ts';

/**
 * How big a settlement is (DESIGN 6c §3c-ii), and everything that follows from it.
 *
 * The tier comes first: it says how many SOULS the place has — the real curve, up
 * by about ten times a rung — and, separately, how much of it the engine actually
 * simulates: the crowd it may field, the plots its ground holds, how wide that
 * ground is. Those two are not the same number and must not be made one; ten
 * million people cannot be walked past.
 */

export const SETTLEMENT_TIERS = ['hamlet', 'village', 'town', 'city', 'metropolis', 'megacity'] as const;
export type SettlementTier = (typeof SETTLEMENT_TIERS)[number];
export type Caps = { souls: [number, number]; crowd: number; plots: number; radius: number; ruler: string };

export const CAPS: Record<SettlementTier, Caps> = {
  hamlet: { souls: [20, 100], crowd: 12, plots: 3, radius: 12, ruler: 'elder' },
  village: { souls: [100, 1_000], crowd: 24, plots: 8, radius: 18, ruler: 'headman' },
  town: { souls: [1_000, 20_000], crowd: 40, plots: 16, radius: 26, ruler: 'mayor' },
  city: { souls: [20_000, 100_000], crowd: 60, plots: 28, radius: 34, ruler: 'lord' },
  metropolis: { souls: [100_000, 1_000_000], crowd: 80, plots: 40, radius: 42, ruler: 'governor' },
  megacity: { souls: [1_000_000, 12_000_000], crowd: 100, plots: 52, radius: 50, ruler: 'overlord' },
};

/**
 * What a tower floor may DEAL. The top two exist for the outer world and for
 * §4's upgrading: past a city one hub map is a lie, and a metropolis wants
 * districts, which nothing draws yet.
 */
const DEALT: readonly SettlementTier[] = ['hamlet', 'village', 'town', 'city'];
/** Most places are small. The weights are over `DEALT`, in its order. */
const WEIGHTS = [0.35, 0.3, 0.2, 0.15];

export type TownPlan = { square: Cell; streets: Cell[]; plots: { door: Cell; footprint: Cell[] }[] };

const placeIn = (world: World, region: RegionId, place: PlaceId): Place | null => {
  // Callers that hold only part of a world — the population reader is one — have no
  // places to look in, and a place nobody can see has no tier.
  const record = (world.regions ?? {})[region];
  return (record && isFull(record) ? record.places.find((p) => p.id === place) : undefined) ?? null;
};

/** What this settlement grew into. Stored when it was dealt or upgraded; otherwise dealt now. */
export function tierOf(world: World, region: RegionId, place: PlaceId): SettlementTier | null {
  const here = placeIn(world, region, place);
  if (!here || here.kind !== 'settlement') return null;
  if (here.tier) return here.tier;
  let draw = pairDraw(world.seed, 0x7e12, region, place);
  for (const [i, weight] of WEIGHTS.entries()) {
    if (draw < weight) return DEALT[i];
    draw -= weight;
  }
  return DEALT[DEALT.length - 1];
}

/** How many people say they live here: the real curve, inside the tier's rung. */
export function soulsOf(world: World, region: RegionId, place: PlaceId): number | null {
  const tier = tierOf(world, region, place);
  if (!tier) return null;
  const [low, high] = CAPS[tier].souls;
  const rng = mulberry32(Math.floor(pairDraw(world.seed, 0x5015, region, place) * 2 ** 32));
  return low + Math.floor(rng() * (high - low + 1));
}

/** Who rules here, and what a ruler of a place this size is called. */
export function rulerOf(world: World, region: RegionId, place: PlaceId): { who: string; rank: string } | null {
  const here = placeIn(world, region, place);
  const tier = tierOf(world, region, place);
  if (!here || !tier) return null;
  const who = holderOf(here, world.people);
  return who ? { who, rank: CAPS[tier].ruler } : null;
}

/**
 * The town's plan: its square, the streets that run from every way in to it, and
 * the plots along them.
 *
 * DERIVED, not drawn. The ground itself is open; what a plan says is where people
 * walk and where a building may stand — which is what the stations stage stamps
 * its footprints onto.
 */
export function townPlan(world: World, region: RegionId, place: PlaceId): TownPlan | null {
  const tier = tierOf(world, region, place);
  if (!tier) return null;
  const map = drawMap(world, hubId(region, place));
  const open = (c: Cell) => (map.rows[c.y]?.[c.x] ?? '#') !== '#';
  const square = { x: Math.floor((map.rows[0]?.length ?? 1) / 2), y: Math.floor(map.rows.length / 2) };

  const streets: Cell[] = [];
  const onStreet = new Set<string>();
  for (const door of portalsOf(world, map)) {
    // Straight in from the door to the square: the way everyone walks.
    let at = { x: door.x, y: door.y };
    for (let guard = 0; guard < 4 * CAPS[tier].radius && (at.x !== square.x || at.y !== square.y); guard++) {
      if (open(at) && !onStreet.has(`${at.x},${at.y}`)) {
        onStreet.add(`${at.x},${at.y}`);
        streets.push({ ...at });
      }
      at = { x: at.x + Math.sign(square.x - at.x), y: at.y + Math.sign(square.y - at.y) };
    }
  }
  if (!onStreet.has(`${square.x},${square.y}`)) {
    onStreet.add(`${square.x},${square.y}`);
    streets.push(square);
  }

  // Plots line the streets, on either side, spaced so their walls will not meet.
  const plots: TownPlan['plots'] = [];
  const taken = new Set(onStreet);
  for (const cell of streets) {
    if (plots.length >= CAPS[tier].plots) break;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      if (plots.length >= CAPS[tier].plots) break;
      const door = { x: cell.x + dx, y: cell.y + dy };
      const footprint: Cell[] = [];
      for (let step = 1; step <= 3; step++) {
        for (const across of [-1, 0, 1]) {
          footprint.push({ x: door.x + dx * step + (dx ? 0 : across), y: door.y + dy * step + (dy ? 0 : across) });
        }
      }
      const room = [door, ...footprint].every((c) => open(c) && !taken.has(`${c.x},${c.y}`));
      if (!room) continue;
      for (const c of [door, ...footprint]) taken.add(`${c.x},${c.y}`);
      // Keep the ground beside a plot clear, so two of them never share a wall.
      for (const c of footprint) for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) taken.add(`${c.x + d[0]},${c.y + d[1]}`);
      plots.push({ door, footprint });
    }
  }
  return { square, streets, plots };
}

/**
 * How many of a settlement's plots are still free, given `occupiedModules`
 * already standing (DESIGN 6c §3f). Callers derive that count for real via
 * `occupiedModulesOf`; this only reads the real plot count off the plan.
 */
export function freePlotsOf(world: World, region: RegionId, place: PlaceId, occupiedModules: number): number | null {
  const plan = townPlan(world, region, place);
  return plan ? plan.plots.length - occupiedModules : null;
}

/** The building `id` standing on `place`, or null if none does. */
export function buildingAt(place: Place, id: string): Building | null {
  return place.buildings?.find((b) => b.id === id) ?? null;
}

/** `place` with `building` added, unless its id is already taken — a no-op then, never a silent overwrite. */
export function addBuilding(place: Place, building: Building): Place {
  if (building.id !== undefined && buildingAt(place, building.id)) return place;
  return { ...place, buildings: [...(place.buildings ?? []), building] };
}

/** How many modules every building standing on `place` occupies, summed — the real count `freePlotsOf` wants. */
export function occupiedModulesOf(place: Place): number {
  return (place.buildings ?? []).reduce((sum, b) => sum + modulesNeeded(b.workstations?.length ?? 0), 0);
}
