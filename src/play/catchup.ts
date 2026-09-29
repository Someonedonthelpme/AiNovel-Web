import { finalAbilities } from '../session/sheet.ts';
import { TICKS_PER_HOUR } from '../world/calendar.ts';
import { activeRegion, clockOf } from '../world/travel.ts';
import type { PersonId, World } from '../world/types.ts';
import { efficiencyOf, runWorkstation, statFor } from '../world/workstation.ts';
import type { SubMethod } from '../world/workstation.ts';
import { MAX_ABILITY } from './signetbook.ts';

// ponytail: flat placeholder — only people who fight or travel carry a sheet (world/types.ts Person), so
// most workers have no ability to read; real numbers wait on no-rebalance-until-feature-complete.
const NPC_PLACEHOLDER_ABILITY = 10;

/** How well `who` runs a workstation with this method: their real stat if they carry a sheet, else the placeholder. */
function efficiencyFor(world: World, who: PersonId, method: SubMethod): number {
  const sheet = world.people[who]?.sheet;
  const ability = sheet ? finalAbilities(sheet)[statFor(method)] : NPC_PLACEHOLDER_ABILITY;
  return efficiencyOf('raw-stat', ability, [1, MAX_ABILITY]);
}

/**
 * A building keeps working while you are away, and is caught up when you ARRIVE (DESIGN 6c §3h, §3j-i).
 * Runs only on the turn the player changes place, in the fold, from state alone — so a replay makes
 * the same goods. The first time a building is seen it is only stamped (`workedAt`). After that its
 * economic workstations run for the hours since the stamp, staffed by the living people at the place
 * who are not out on the road: one person, one workstation, best fit first, in building order. Service
 * and administrative stations are skipped. Nobody there means nothing is made, and the visit is still stamped.
 *
 * ponytail: a fraction of a batch is dropped when the stamp resets, so a hop away and straight back
 * loses it; carry the remainder on the building if short trips ever matter.
 */
export function caughtUp(before: World, world: World): World {
  if (before.currentPlace === world.currentPlace && before.currentRegion === world.currentRegion) return world;
  const region = activeRegion(world);
  const place = region?.places.find((p) => p.id === world.currentPlace);
  if (!region || !place?.buildings?.length) return world;

  const now = clockOf(world);
  const onRoad = new Set((world.journeys ?? []).map((j) => j.who));
  const free = place.people.filter((id) => world.people[id]?.alive && !onRoad.has(id));
  const taken = new Set<PersonId>();

  const buildings = place.buildings.map((building) => {
    if (building.workedAt === undefined) return { ...building, workedAt: now };
    const hours = (now - building.workedAt) / TICKS_PER_HOUR;
    let current = building;
    if (hours > 0) {
      for (const ws of building.workstations ?? []) {
        if (ws.subkind !== 'economic' || !ws.method || !ws.id) continue;
        const method = ws.method;
        const worker = free
          .filter((id) => !taken.has(id))
          .map((id) => ({ id, efficiency: efficiencyFor(world, id, method) }))
          .sort((a, b) => b.efficiency - a.efficiency || (a.id < b.id ? -1 : 1))[0];
        if (!worker) continue;
        taken.add(worker.id);
        const result = runWorkstation(current, ws.id, hours, worker.efficiency);
        if (result) current = { ...current, container: result.container };
      }
    }
    return { ...current, workedAt: now };
  });

  const next = { ...place, buildings };
  return { ...world, regions: { ...world.regions, [region.id]: { ...region, places: region.places.map((p) => (p.id === place.id ? next : p)) } } };
}
