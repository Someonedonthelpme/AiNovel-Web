import { holderOf } from '../world/holding.ts';
import { successionOf } from '../world/al.ts';
import type { AlUnit } from '../world/al.ts';
import type { PersonId, Place, World } from '../world/types.ts';
import { axisOf } from '../social/edge.ts';
import { STATIONS, stationOf } from './station.ts';

/**
 * Who holds a settlement under the law its AL unit follows (DESIGN 6c §3k-i).
 *
 * `standing` is `holderOf` itself. `stationRank` picks the highest absolute `Station`
 * present; `elective` the person the OTHERS present trust most, summed. A tie under
 * either falls back to `standing` among the tied. A stored holder (the player's, bought)
 * is never overridden, and the dead never inherit.
 */
export function holderUnder(world: World, region: { alUnits?: Record<string, AlUnit> }, place: Place): PersonId | null {
  const law = place.alUnit ? successionOf(region, place.alUnit) : 'standing';
  if (law === 'standing' || place.kind !== 'settlement' || place.holder) return holderOf(place, world.people);

  const here = place.people.filter((id) => world.people[id] && world.people[id].alive !== false);
  const score = law === 'stationRank'
    ? (id: PersonId) => -STATIONS.indexOf(stationOf(world, id))
    : (id: PersonId) => here.reduce((sum, from) => (from === id ? sum : sum + axisOf(world.edges, from, id, 'trust')), 0);
  const best = Math.max(...here.map(score));
  return holderOf({ ...place, people: here.filter((id) => score(id) === best) }, world.people);
}
