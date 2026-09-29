import { tierOf } from './settlement.ts';
import type { SettlementTier } from './settlement.ts';
import type { Place, RegionId, World } from './types.ts';
import type { Building } from './workstation.ts';

/*
 * A slice of DESIGN 6c §3i's catalogue: seven building types, dealt by tier. Nothing generated
 * ever had a building, so the station system only ran on hand-built fixtures; this makes it
 * reachable in a real world. Not dealt: the general store and armoury (nothing to run yet).
 */

const HALL: Building = { id: 'hall-1', tier: 1, container: {}, workstations: [{ id: 'hall-desk', subkind: 'administrative' }] };

const PASTURE: Building = {
  id: 'pasture-1', tier: 1, container: {},
  workstations: [{ id: 'graze', subkind: 'economic', method: { input: [], output: [{ category: 'rations', count: 1 }, { category: 'material', count: 1 }], time: 2 } }],
};

// ponytail: flat placeholder stock — containers do not move goods between buildings, so a smithy that
// starts empty would idle forever; real numbers wait on no-rebalance-until-feature-complete.
const SMITHY: Building = {
  id: 'smithy-1', tier: 1, container: { material: 4 },
  workstations: [{ id: 'anvil', subkind: 'economic', method: { input: [{ category: 'material', count: 1 }], output: [{ category: 'weapon', count: 1 }], time: 1 } }],
};

const HOME: Building = {
  id: 'home-1', tier: 1, container: {},
  workstations: [{ id: 'bed', subkind: 'service', serviceMethod: { output: [{ need: 'rest', amount: 1 }], time: 1 } }],
};

const INN: Building = {
  id: 'inn-1', tier: 1, container: {},
  workstations: [{ id: 'hearth', subkind: 'service', serviceMethod: { output: [{ need: 'rest', amount: 3 }], time: 0.3 } }],
};

// ponytail: seed has no source yet (no item, unreachable from combat), so the field starts stocked like the smithy.
const FARMSTEAD: Building = {
  id: 'farmstead-1', tier: 1, container: { seed: 4 },
  workstations: [{ id: 'subsistence', subkind: 'economic', method: { input: [{ category: 'seed', count: 1 }], output: [{ category: 'rations', count: 1 }], time: 2 } }],
};

const TANNERY: Building = {
  id: 'tannery-1', tier: 1, container: { material: 4 },
  workstations: [{ id: 'hand-cure', subkind: 'economic', method: { input: [{ category: 'material', count: 1 }], output: [{ category: 'pack', count: 1 }], time: 1 } }],
};

const VILLAGE = [HALL, PASTURE, SMITHY, FARMSTEAD, INN, HOME] as const;
const TOWN = [...VILLAGE, TANNERY] as const;

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
