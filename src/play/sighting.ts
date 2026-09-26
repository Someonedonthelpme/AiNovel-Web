import { claimKey, firsthand, retell } from '../character/belief.ts';
import type { Belief, Claim } from '../character/belief.ts';
import { PLAYER, reachedBy, regardedBy } from '../social/edge.ts';
import { activeRegion, clockOf } from '../world/travel.ts';
import { isNight } from '../world/calendar.ts';
import { fieldEnds, positionOf } from '../world/map.ts';
import { groupOf, speciesIdFor } from '../character/species.ts';
import { habitOf } from '../character/habitat.ts';
import { stationOf } from './station.ts';
import type { World } from '../world/types.ts';

/**
 * Word of where somebody was (DESIGN 6b stage 7.1c).
 *
 * A grudge heads for where it last HEARD the player was, not for where the
 * player is. Whoever stands where the player stands sees them, firsthand; the
 * sighting passes one hop a turn along people's edges, like a deed; and a place
 * where nobody connected to a pursuer sees you hides you from them. A belief,
 * so it lives with everything else a person holds true, and can be stale.
 */
export type Sighting = Extract<Claim, { kind: 'sighting' }>;

export const sightingClaim = (who: string, region: string, place: string, at: number): Sighting =>
  ({ kind: 'sighting', who, region, place, at });

/** The newest word a person holds of where `who` was. */
export function newestSighting(beliefs: readonly Belief[], who: string): Sighting | null {
  const held = beliefs.find((b) => b.holds && b.claim.kind === 'sighting' && b.claim.who === who);
  return held ? (held.claim as Sighting) : null;
}

/**
 * Take on a sighting. NEWER wins, not surer: where somebody was an hour ago
 * beats where they were yesterday, however it was heard. At the same tick, the
 * surer account. One per person seen, so what a person holds cannot grow.
 */
export function hearOf(beliefs: readonly Belief[], belief: Belief): Belief[] {
  if (belief.claim.kind !== 'sighting') return [...beliefs];
  const key = claimKey(belief.claim);
  const held = beliefs.find((b) => claimKey(b.claim) === key);
  if (held?.claim.kind === 'sighting') {
    const newer = belief.claim.at > held.claim.at
      || (belief.claim.at === held.claim.at && belief.confidence > held.confidence);
    if (!newer) return [...beliefs];
  }
  return [...beliefs.filter((b) => claimKey(b.claim) !== key), belief];
}

/**
 * Who is out where the player stands: the place's people, less any of them away
 * on the road, plus whoever has travelled here — and at NIGHT only guards and
 * night kinds (7.1e). They are who can see the player, and who can be met; the
 * Director and the Writer read this too. In the place's own order, arrivals last.
 */
export function presentHere(world: World): string[] {
  // OUT ON THE ROAD (W5): the people of the place you set out from are a road
  // behind you. Only somebody who has come to where you are is with you — which
  // is what a meeting on a field records. Kept free of tiles: the fold reads this.
  const onRoad = fieldEnds(positionOf(world).map) !== null;
  const place = onRoad ? undefined : activeRegion(world)?.places.find((p) => p.id === world.currentPlace);
  const journeys = world.journeys ?? [];
  const isHere = (j: { region: string; place: string | null }) =>
    j.region === world.currentRegion && j.place === world.currentPlace;
  const away = new Set(journeys.filter((j) => !isHere(j)).map((j) => j.who));
  const arrived = journeys.filter(isHere).map((j) => j.who);
  const here = [...new Set([...(place?.people ?? []).filter((id) => !away.has(id)), ...arrived])];
  return isNight(world) ? here.filter((id) => outAtNight(world, id)) : here;
}

/** Whether somebody is about after dark: a guard on watch, or one of a night kind. */
export function outAtNight(world: World, id: string): boolean {
  if (stationOf(world, id) === 'guard') return true;
  const kinds = world.species ?? [];
  const person = world.people[id];
  const species = person?.species ?? person?.sheet?.species ?? speciesIdFor(world.seed, id, kinds);
  const group = groupOf(kinds, species);
  return group ? habitOf(world.seed, group).nocturnal : false;
}

/** Everyone where the player stands sees them, firsthand, at this tick. */
export function witnessSighting(world: World): World {
  const claim = sightingClaim(PLAYER, world.currentRegion, world.currentPlace, clockOf(world));
  return tellEach(world, [...presentHere(world)].sort().map((id) => [id, firsthand(claim)]));
}

/**
 * Word of the player passes ONE hop, from everyone who held it when this began
 * to everyone they have any dealing with, either way round. Never to the player.
 */
export function passSightings(world: World): World {
  const told: [string, Belief][] = [];
  for (const teller of Object.keys(world.people).sort()) {
    const held = (world.people[teller].beliefs ?? [])
      .find((b) => b.claim.kind === 'sighting' && b.claim.who === PLAYER);
    if (!held) continue;
    const word = retell(held, teller);
    const listeners = new Set([...reachedBy(world.edges, teller), ...regardedBy(world.edges, teller)]);
    for (const listener of [...listeners].sort()) {
      if (listener !== PLAYER) told.push([listener, word]);
    }
  }
  return tellEach(world, told);
}

function tellEach(world: World, told: readonly [string, Belief][]): World {
  if (told.length === 0) return world;
  const people = { ...world.people };
  for (const [id, belief] of told) {
    const person = people[id];
    if (person) people[id] = { ...person, beliefs: hearOf(person.beliefs ?? [], belief) };
  }
  return { ...world, people };
}
