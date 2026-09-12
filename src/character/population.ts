import { hashText, mulberry32 } from '../engine/roll.ts';
import { packAt } from './habitat.ts';
import { leavesUnder } from './species.ts';
import type { Species } from './species.ts';

/**
 * WHO LIVES HERE — a crowd as a population rather than as prose.
 *
 * There are no mass foes: a thing that fights is somebody out of a place's
 * population (`crowd.ts`). This is the population that somebody comes out of,
 * and the reason it is stored at all is the one reader that makes a crowd more
 * than a decoration: KILLING THINS IT. Clear the wolves off the gate and what
 * meets you at the gate afterwards is thinner, and eventually nothing.
 *
 * Keyed by PLACE, not by region — 6c makes a province one place with one map,
 * so nothing has to migrate later, and the gate emptying while the square is
 * untouched is the whole point. It is exactly the shape `Ambient` already has.
 *
 * DERIVED UNTIL IT IS TOUCHED. A place nobody has fought at stores nothing and
 * answers from the seed, the same trick the arena, a way out and a lorebook all
 * use; the first kill is what writes it down. So an old world needs no
 * migration, and a world nobody has killed anything in costs nothing to store.
 */

/** What they do. Closed: a profession decides a weapon, not a personality. */
export const PROFESSIONS = ['hunter', 'watcher', 'brute', 'raider'] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** So many of one lineage, at one trade, living here. */
export type Cohort = { subspecies: string; profession: Profession; size: number };

/** Per place, who lives there. On the World, for the reason `Ambient` is. */
export type Populations = Record<string, Cohort[]>;

/** Most lineages keep to a trade or two; a crowd of specialists is not a crowd. */
const TRADES = [1, 1, 2, 2, 3];

/**
 * How many of each.
 *
 * Small on purpose. A place holding sixty creatures would never visibly thin
 * inside one playthrough, and a thinning nobody can see is the simulation
 * nothing touches that this exists to avoid.
 */
const SIZES = [2, 3, 3, 4, 4, 5, 6];

/**
 * The aggregate a compressed floor keeps.
 *
 * Place ids are the MODEL's words (`floorgen.ts:361`), so they do not survive
 * compression and come back different — a place-keyed population would be
 * thrown away every time you left the floor. One lossy floor-wide total is kept
 * under this key instead, and every place of a rehydrated floor reads it. 6c
 * removes compression and this with it.
 */
export const aggregateKey = (region: string): string => `region:${region}`;

/** Who would live at a place, from the seed alone. Parents of the pack, its leaves. */
export function derivePopulation(
  seed: number,
  nodes: readonly Species[],
  group: string,
  place: string,
  floor: number,
): Cohort[] {
  const out: Cohort[] = [];
  for (const leaf of leavesUnder(nodes, group)) {
    const rng = mulberry32(hashText(`${seed}|${place}|${floor}|${leaf.id}`));
    const trades = TRADES[Math.floor(rng() * TRADES.length)];
    // Walked from a random offset rather than drawn into a set, so it cannot
    // spin and so the same seed always deals the same trades.
    const at = Math.floor(rng() * PROFESSIONS.length);
    for (let n = 0; n < trades; n++) {
      out.push({
        subspecies: leaf.id,
        profession: PROFESSIONS[(at + n) % PROFESSIONS.length],
        size: SIZES[Math.floor(rng() * SIZES.length)],
      });
    }
  }
  return out;
}

type PopulatedWorld = {
  seed: number;
  species?: Species[];
  populations?: Populations;
};

/**
 * Who is left at a place.
 *
 * The stored list first, then the floor's aggregate if this floor has been
 * compressed and come back, then the seed. Empty means it has been cleared out
 * — which is not the same answer as a world that holds no kinds at all, and the
 * callers have to keep the two apart or thinning a place silently summons the
 * statblocks it replaced.
 */
export function populationAt(
  world: PopulatedWorld,
  region: string,
  place: string,
  floor: number,
): Cohort[] | null {
  const kinds = world.species ?? [];
  const group = packAt(world.seed, kinds, floor);
  if (!group) return null;

  const stored = world.populations?.[place] ?? world.populations?.[aggregateKey(region)];
  return stored ?? derivePopulation(world.seed, kinds, group, place, floor);
}

/** How many live there, all lineages and trades together. */
export const sizeIn = (cohorts: readonly Cohort[]): number => cohorts.reduce((n, c) => n + c.size, 0);

/**
 * Take the dead out of the population.
 *
 * Matched on lineage AND trade, because that pair is what a cohort IS: killing
 * the wolf-hunters must not quietly remove wolf-brutes instead. A cohort that
 * reaches nought is dropped, so the list shrinks rather than filling with
 * zeroes, and something with no cohort left to come out of cannot be met again.
 */
export function thinPopulation(
  world: PopulatedWorld,
  region: string,
  place: string,
  floor: number,
  dead: readonly { subspecies: string; profession: Profession }[],
): Populations | undefined {
  const cohorts = populationAt(world, region, place, floor);
  if (!cohorts || dead.length === 0) return world.populations;

  let left = cohorts;
  for (const who of dead) {
    const at = left.findIndex((c) => c.subspecies === who.subspecies && c.profession === who.profession && c.size > 0);
    if (at < 0) continue;
    left = left.map((c, i) => (i === at ? { ...c, size: c.size - 1 } : c));
  }

  return { ...world.populations, [place]: left.filter((c) => c.size > 0) };
}

/**
 * A floor's places folded into one total, because the places are about to go.
 *
 * Called when a region compresses. Lossy by decision: what comes back is a
 * thinned floor, not a thinned gate.
 */
export function aggregate(populations: Populations | undefined, region: string, places: readonly string[]): Populations {
  const held = places.filter((p) => populations?.[p]);
  if (!populations || held.length === 0) return populations ?? {};

  const summed: Cohort[] = [];
  for (const place of held) {
    for (const cohort of populations[place]) {
      const at = summed.findIndex((c) => c.subspecies === cohort.subspecies && c.profession === cohort.profession);
      if (at < 0) summed.push({ ...cohort });
      else summed[at] = { ...summed[at], size: summed[at].size + cohort.size };
    }
  }

  const out = { ...populations };
  for (const place of held) delete out[place];
  return { ...out, [aggregateKey(region)]: summed };
}
