import { trustToward } from '../social/edge.ts';
import type { Gazetteer, PersonId, Region, RegionId, World } from './types.ts';
import { isFull } from './types.ts';
import { isStatic } from './strata.ts';
import { aggregate } from '../character/population.ts';

/**
 * Tiered persistence — how "every floor is a persistent region" stays
 * affordable.
 *
 * Compress PLACES, preserve PEOPLE. Nobody remembers the street layout of a
 * town forty floors down, but everybody remembers the person who betrayed them
 * there. Geometry is dropped; identity, unfinished business and standing are
 * kept, and named people live in a global registry that is never compressed.
 *
 * Storage then grows linearly and slowly, while the prompt does not grow at all
 * — the canon guard retrieves the top-k relevant facts rather than including
 * every region.
 */

/** A factual fallback summary, used when no authored one is supplied. */
export function deriveSummary(region: Region): string {
  const settlements = region.places.filter((p) => p.kind === 'settlement').map((p) => p.name);
  const landmarks = region.places.filter((p) => p.kind === 'landmark').map((p) => p.name);
  const parts = [`${region.name} is a ${region.biome} on floor ${region.floor}.`];
  if (region.culture) parts.push(region.culture);
  if (settlements.length) parts.push(`Settlements: ${settlements.join(', ')}.`);
  if (landmarks.length) parts.push(`Landmarks: ${landmarks.join(', ')}.`);
  return parts.join(' ');
}

export type CompressOptions = {
  /** An authored summary; a factual one is derived when omitted. */
  summary?: string;
  openThreads?: string[];
  reputation?: number;
};

export function compressRegion(region: Region, turn: number, opts: CompressOptions = {}): Gazetteer {
  const knownPeople: PersonId[] = [...new Set(region.places.flatMap((p) => p.people))];
  return {
    detail: 'gazetteer',
    id: region.id,
    floor: region.floor,
    name: region.name,
    biome: region.biome,
    summary: opts.summary ?? deriveSummary(region),
    knownPeople,
    openThreads: opts.openThreads ?? [],
    reputation: opts.reputation ?? 0,
    compressedAtTurn: turn,
  };
}

/**
 * Compress every full region except the one being entered and the one being
 * left, so stepping up and back down again does not throw away detail you are
 * about to need.
 */
export function compressExcept(world: World, keep: RegionId[], turn: number): World {
  const kept = new Set(keep);
  const regions = { ...world.regions };
  /*
   * Who lives there goes the way the geometry does, but not all the way.
   *
   * A population is keyed by PLACE, and place ids are the model's own words, so
   * the floor that comes back has different ones and a place-keyed thinning
   * would be silently thrown away every time you left. The floor's places are
   * folded into ONE total instead — a thinned floor rather than a thinned gate.
   * Lossy by decision; 6c removes compression and this with it.
   */
  let populations = world.populations;
  for (const [id, record] of Object.entries(world.regions)) {
    if (kept.has(id) || !isFull(record)) continue;
    // A STATIC stratum is authored once and frozen. Compression is the only
    // thing that throws detail away, so not compressing IS the freeze: the
    // floor is still there, exactly as written, and never needs rebuilding.
    //
    // ponytail: a frozen world therefore holds every floor it has ever shown
    // you, in full, in one jsonb blob. Fine for a twenty-floor tower, which is
    // the case this exists for. Page them out of the snapshot and rebuild from
    // the generation events in the log if a static world ever runs long.
    if (isStatic(world, record.floor)) continue;
    // The standing you earned here travels with the summary. It lives on the
    // World so it survives rehydration too; this copy is what the returning
    // brief reads, and it is `Gazetteer.reputation`'s first writer ever.
    regions[id] = compressRegion(record, turn, { reputation: world.reputation?.[id] ?? 0 });
    populations = aggregate(populations, id, record.places.map((p) => p.id));
  }
  return { ...world, regions, ...(populations ? { populations } : {}) };
}

/** People named by a region, so they can be checked against the registry. */
export function peopleOf(region: Region): PersonId[] {
  return [...new Set(region.places.flatMap((p) => p.people))];
}

/**
 * What a generator must be given to rebuild a compressed region CONSISTENTLY.
 *
 * Returning is a rehydration, never a regeneration: the gazetteer is canon and
 * the rebuilt detail has to agree with it, which is what makes it the same town
 * rather than a similar one.
 */
export type RehydrationBrief = {
  gazetteer: Gazetteer;
  /** Full records for the people who belong there, in voice. */
  people: { id: PersonId; name: string; oneLine: string; trust: number; alive: boolean }[];
  facts: string[];
};

export function rehydrationBrief(world: World, gazetteer: Gazetteer): RehydrationBrief {
  return {
    gazetteer,
    people: gazetteer.knownPeople
      .map((id) => world.people[id])
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, name: p.name, oneLine: p.oneLine, trust: trustToward(world.edges, p.id), alive: p.alive })),
    facts: world.facts.filter((f) => f.region === gazetteer.id).map((f) => f.text),
  };
}

export type WorldFootprint = { full: number; gazetteer: number; people: number; facts: number };

/** Cheap health check that tiering is actually holding. */
export function footprint(world: World): WorldFootprint {
  const records = Object.values(world.regions);
  return {
    full: records.filter(isFull).length,
    gazetteer: records.length - records.filter(isFull).length,
    people: Object.keys(world.people).length,
    facts: world.facts.length,
  };
}
