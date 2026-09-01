import { peopleBudget, placeBudget, settlementBudget } from './budget.ts';
import type { Person, PlaceId, Region } from './types.ts';

/**
 * Region integrity, checked before a generated floor is ever played.
 *
 * This is the direct descendant of the mystery's solvability validator: there
 * the question was "can this case be solved", here it is "can this floor be
 * crossed". Both are reachability walks, and both catch the failure that cannot
 * be fixed at play time — a generated space the player is trapped in.
 */

export type Issue = { code: string; message: string; refs?: string[] };

export type RegionValidation = {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  reachable: PlaceId[];
  unreachable: PlaceId[];
};

/** Breadth-first walk across place connections from the entrance. */
export function reachablePlaces(region: Region): Set<PlaceId> {
  const byId = new Map(region.places.map((p) => [p.id, p]));
  const seen = new Set<PlaceId>();
  const queue: PlaceId[] = [];

  if (byId.has(region.entrance)) {
    seen.add(region.entrance);
    queue.push(region.entrance);
  }

  while (queue.length > 0) {
    const place = byId.get(queue.shift() as PlaceId);
    if (!place) continue;
    for (const next of place.connections) {
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

export function validateRegion(region: Region, people: Record<string, Person>): RegionValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const ids = region.places.map((p) => p.id);
  const idSet = new Set(ids);

  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) {
    errors.push({ code: 'DUPLICATE_PLACE_ID', message: 'Duplicate place ids.', refs: [...new Set(duplicates)] });
  }

  // --- edges ---------------------------------------------------------------
  for (const place of region.places) {
    if (place.connections.includes(place.id)) {
      errors.push({ code: 'SELF_CONNECTION', message: `"${place.id}" connects to itself.`, refs: [place.id] });
    }
    for (const to of place.connections) {
      if (!idSet.has(to)) {
        errors.push({
          code: 'DANGLING_CONNECTION',
          message: `"${place.id}" connects to unknown place "${to}".`,
          refs: [place.id, to],
        });
        continue;
      }
      const other = region.places.find((p) => p.id === to);
      if (other && !other.connections.includes(place.id)) {
        // One-way corridors are how a player gets stranded.
        errors.push({
          code: 'ASYMMETRIC_CONNECTION',
          message: `"${place.id}" connects to "${to}" but not the other way round.`,
          refs: [place.id, to],
        });
      }
    }
    for (const personId of place.people) {
      if (!people[personId]) {
        errors.push({
          code: 'DANGLING_PERSON',
          message: `"${place.id}" hosts unknown person "${personId}".`,
          refs: [place.id, personId],
        });
      }
    }
    if (place.affordances.length === 0) {
      warnings.push({
        code: 'NO_AFFORDANCES',
        message: `"${place.id}" offers nothing to do; the Director will have to invent.`,
        refs: [place.id],
      });
    }
  }

  // --- entrance and exit ---------------------------------------------------
  if (!idSet.has(region.entrance)) {
    errors.push({ code: 'MISSING_ENTRANCE', message: `Entrance "${region.entrance}" is not a place in this region.` });
  }
  if (region.exit !== null && !idSet.has(region.exit)) {
    errors.push({ code: 'MISSING_EXIT', message: `Exit "${region.exit}" is not a place in this region.` });
  }

  // --- traversability ------------------------------------------------------
  const reachable = reachablePlaces(region);
  const unreachable = ids.filter((id) => !reachable.has(id));

  if (region.exit !== null && idSet.has(region.exit) && !reachable.has(region.exit)) {
    errors.push({
      code: 'EXIT_UNREACHABLE',
      message: 'The way up cannot be reached from the entrance — the player would be trapped.',
      refs: [region.exit],
    });
  }
  if (unreachable.length > 0) {
    warnings.push({
      code: 'ORPHAN_PLACES',
      message: `${unreachable.length} place(s) cannot be reached from the entrance.`,
      refs: unreachable,
    });
  }

  // --- budgets -------------------------------------------------------------
  const places = placeBudget(region.floor);
  if (region.places.length < places.min || region.places.length > places.max) {
    warnings.push({
      code: 'PLACE_COUNT_OFF_BUDGET',
      message: `Floor ${region.floor} has ${region.places.length} places; budget is ${places.min}-${places.max}.`,
    });
  }

  const named = new Set(region.places.flatMap((p) => p.people));
  const peopleCap = peopleBudget(region.floor);
  if (named.size > peopleCap.max) {
    warnings.push({
      code: 'TOO_MANY_PEOPLE',
      message: `Floor ${region.floor} names ${named.size} people; budget caps at ${peopleCap.max}.`,
    });
  }

  const settlements = region.places.filter((p) => p.kind === 'settlement').length;
  const settlementCap = settlementBudget(region.floor);
  if (settlements < settlementCap.min || settlements > settlementCap.max) {
    warnings.push({
      code: 'SETTLEMENT_COUNT_OFF_BUDGET',
      message: `Floor ${region.floor} has ${settlements} settlements; budget is ${settlementCap.min}-${settlementCap.max}.`,
    });
  }

  return { ok: errors.length === 0, errors, warnings, reachable: [...reachable], unreachable };
}
