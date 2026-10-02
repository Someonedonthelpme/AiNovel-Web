import { tierOf } from './settlement.ts';
import type { SettlementTier } from './settlement.ts';
import type { Place, RegionId, World } from './types.ts';
import type { Building } from './workstation.ts';

/*
 * A slice of DESIGN 6c §3i's catalogue: eleven building types, dealt by tier. Nothing generated
 * ever had a building, so the station system only ran on hand-built fixtures; this makes it
 * reachable in a real world. Not dealt: the general store and armoury (nothing to run yet).
 */

const HALL: Building = { id: 'hall-1', tier: 1, container: {}, category: 'government', workstations: [{ id: 'hall-desk', subkind: 'administrative' }] };

const PASTURE: Building = {
  id: 'pasture-1', tier: 1, container: {}, category: 'agriculture',
  workstations: [{ id: 'graze', subkind: 'economic', method: { input: [], output: [{ category: 'rations', count: 1 }, { category: 'material', count: 1 }], time: 2 } }],
};

// ponytail: flat placeholder stock — containers do not move goods between buildings, so a smithy that
// starts empty would idle forever; real numbers wait on no-rebalance-until-feature-complete.
const SMITHY: Building = {
  id: 'smithy-1', tier: 1, container: { material: 4 }, category: 'production',
  workstations: [{ id: 'anvil', subkind: 'economic', method: { input: [{ category: 'material', count: 1 }], output: [{ category: 'weapon', count: 1 }], time: 1 } }],
};

const HOME: Building = {
  id: 'home-1', tier: 1, container: {}, category: 'residential',
  workstations: [{ id: 'bed', subkind: 'service', serviceMethod: { output: [{ need: 'rest', amount: 1 }], time: 1 }, shift: 'night' }],
};

const INN: Building = {
  id: 'inn-1', tier: 1, container: {}, category: 'amenities',
  workstations: [{ id: 'hearth', subkind: 'service', serviceMethod: { output: [{ need: 'rest', amount: 3 }], time: 0.3 }, shift: 'both' }],
};

// ponytail: seed has no source yet (no item, unreachable from combat), so the field starts stocked like the smithy.
const FARMSTEAD: Building = {
  id: 'farmstead-1', tier: 1, container: { seed: 4 }, category: 'agriculture',
  workstations: [{ id: 'subsistence', subkind: 'economic', method: { input: [{ category: 'seed', count: 1 }], output: [{ category: 'rations', count: 1 }], time: 2 } }],
};

const TANNERY: Building = {
  id: 'tannery-1', tier: 1, container: { material: 4 }, category: 'production',
  workstations: [{ id: 'hand-cure', subkind: 'economic', method: { input: [{ category: 'material', count: 1 }], output: [{ category: 'pack', count: 1 }], time: 1 } }],
};

// The night venues (DESIGN 6c §3i): plain service stations, open after dark, that serve a need. The engine supplies only
// that the place is open and which need it serves; nothing drives them yet, they lift the crowd band at night.
// ponytail: placeholder amounts and times, real numbers wait on no-rebalance-until-feature-complete.
const PUB: Building = {
  id: 'pub-1', tier: 1, container: {}, category: 'amenities',
  workstations: [{ id: 'taproom', subkind: 'service', serviceMethod: { output: [{ need: 'company', amount: 2 }], time: 0.5 }, shift: 'night' }],
};

const BROTHEL: Building = {
  id: 'brothel-1', tier: 1, container: {}, category: 'amenities',
  workstations: [{ id: 'salon', subkind: 'service', serviceMethod: { output: [{ need: 'company', amount: 3 }], time: 1 }, shift: 'night' }],
};

const THEATRE: Building = {
  id: 'theatre-1', tier: 1, container: {}, category: 'amenities',
  workstations: [{ id: 'stage', subkind: 'service', serviceMethod: { output: [{ need: 'purpose', amount: 2 }], time: 2 }, shift: 'night' }],
};

const WATCH_HOUSE: Building = {
  id: 'watch-house-1', tier: 1, container: {}, category: 'government',
  workstations: [{ id: 'watch', subkind: 'service', serviceMethod: { output: [{ need: 'safety', amount: 2 }], time: 1 }, shift: 'both' }],
};

const VILLAGE = [HALL, PASTURE, SMITHY, FARMSTEAD, INN, HOME, PUB] as const;
const TOWN = [...VILLAGE, TANNERY, THEATRE, BROTHEL, WATCH_HOUSE] as const;

/** What a settlement of each tier is dealt. Every settlement has a hall (bare unless it is a seat, §3e). */
const DEALT: Record<SettlementTier, readonly Building[]> = {
  hamlet: [HALL, PASTURE, HOME],
  village: VILLAGE,
  town: TOWN,
  city: TOWN,
  metropolis: TOWN,
  megacity: TOWN,
};

const fresh = (b: Building): Building => ({
  ...b, container: { ...b.container }, workstations: (b.workstations ?? []).map((w) => ({ ...w })),
});

/**
 * `places` with every settlement dealt its buildings by tier. Engine-only and deterministic (no draw at all
 * yet), so a floor rebuilt from the same seed has the same buildings. A place that already has buildings is
 * left alone. `workedAt` is left unset: the first visit stamps it.
 */
export function buildingsFor(world: Pick<World, 'seed' | 'regions'>, regionId: RegionId, places: readonly Place[]): Place[] {
  return places.map((p) => {
    if (p.kind !== 'settlement' || p.buildings?.length) return p;
    const tier = tierOf(world, regionId, p.id);
    return tier ? { ...p, buildings: DEALT[tier].map(fresh) } : p;
  });
}
