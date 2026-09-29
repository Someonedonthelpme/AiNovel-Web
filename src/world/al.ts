import type { Place, PlaceId, RegionId, World } from './types.ts';
import { tierOf } from './settlement.ts';
import type { SettlementTier } from './settlement.ts';

/**
 * The Administrative Layer (DESIGN 6c §3e/§3e-i): an unbounded tree, one per
 * Region, orthogonal to Map Type and to Stratum (which is about vertical
 * floor-to-floor continuity, not this). Governs law scope and population
 * counting; blind to whether the ground under it is wild or settled.
 */
export const AL_RUNGS = ['planet', 'continent', 'sub-continent', 'state', 'province', 'district', 'subdistrict', 'village'] as const;
export type AlRung = (typeof AL_RUNGS)[number];
export type AlUnitId = string;

/**
 * A territorial law an AL unit can adopt (DESIGN 6c §3k/§3k-i): the `criminal`
 * axis — independently adoptable, a hall opts each one in or out. Each one is a
 * real act the engine can already recognize, even though nothing enforces any
 * of them yet (arrest is its own deferred stage). `civil` has no candidate
 * vocabulary at all — no property/tax-rate mechanic exists to read one. Same
 * rule `CONSTRAINTS` already states (`rules/ruleset.ts`): a law grows this list
 * only when it gains a checker, never before.
 */
export const CRIMINAL_LAWS = ['theft', 'trespass', 'assault'] as const;
export type AlLawId = (typeof CRIMINAL_LAWS)[number];

/**
 * `succession`'s closed choice (DESIGN 6c §3k-i): who inherits a settlement's
 * `holder` when it's vacated. `standing` is today's actual `holderOf` rule,
 * formalised as a named option; `stationRank` and `elective` read data that
 * already exists (`Station`, trust edges). `primogeniture`/`gavelkind` are
 * deliberately absent — this codebase has no individual heir/parentage data at
 * all, only species-group kinship, so neither would have a possible checker.
 */
export const SUCCESSION_LAWS = ['standing', 'stationRank', 'elective'] as const;
export type SuccessionLawId = (typeof SUCCESSION_LAWS)[number];

export type AlUnit = { id: AlUnitId; kind: AlRung; parent?: AlUnitId; seat?: PlaceId; laws?: AlLawId[]; succession?: SuccessionLawId };

/** The chain from `alUnitId` up to its root, itself first. Bounded by unit count, so a parent cycle cannot hang the fold. */
export function ancestorsOf(region: { alUnits?: Record<AlUnitId, AlUnit> }, alUnitId: AlUnitId): AlUnit[] {
  const units = region.alUnits ?? {};
  const chain: AlUnit[] = [];
  let at: AlUnit | undefined = units[alUnitId];
  while (at && chain.length <= Object.keys(units).length) {
    chain.push(at);
    at = at.parent ? units[at.parent] : undefined;
  }
  return chain;
}

/**
 * Who rules this AL unit (DESIGN 6c §3e, settled 2026-09-26): the seat's own
 * derived ruler operates the seat's hall, whose scope IS this AL unit's law — so
 * an AL unit's ruler is never stored, only the seat's PlaceId is. Inherited up
 * from the nearest ancestor that has one; null if none of them does.
 */
export function rulerSeatOf(region: { alUnits?: Record<AlUnitId, AlUnit> }, alUnitId: AlUnitId): PlaceId | null {
  for (const unit of ancestorsOf(region, alUnitId)) {
    if (unit.seat) return unit.seat;
  }
  return null;
}

/**
 * The AL unit `place`'s hall may adopt law for, or null if it has none
 * (DESIGN 6c §3f/§3k): only the unit's own SEAT settlement has a hall with
 * real scope — every other settlement inside that unit is "bare, local-only"
 * (§3i's hall tier-name table), because the unit's law-editing authority
 * belongs to whichever hall the ruler actually sits in, not every hall inside
 * the unit's borders.
 */
export function hallScopeOf(region: { alUnits?: Record<AlUnitId, AlUnit> }, place: Pick<Place, 'id' | 'alUnit'>): AlUnitId | null {
  const unit = place.alUnit ? region.alUnits?.[place.alUnit] : undefined;
  return unit?.seat === place.id ? unit.id : null;
}

/**
 * Adopt `law` onto `alUnitId`'s own set, idempotent. Pure — whether the
 * caller may legally do this (only a seat's hall, via `hallScopeOf`) is the
 * play layer's job, the same division `runWorkstation` already draws between
 * engine mechanism and verb legality.
 */
export function adoptLaw(alUnits: Record<AlUnitId, AlUnit>, alUnitId: AlUnitId, law: AlLawId): Record<AlUnitId, AlUnit> {
  const unit = alUnits[alUnitId];
  if (!unit || unit.laws?.includes(law)) return alUnits;
  return { ...alUnits, [alUnitId]: { ...unit, laws: [...(unit.laws ?? []), law] } };
}

/**
 * Every law binding at `alUnitId`: its own adopted set, plus every ancestor's
 * (DESIGN 6c §3k) — a lower tier automatically inherits its overlord's law,
 * "imperial palace bigger than town hall." Never stored on the unit itself;
 * derived at query time, same as `rulerSeatOf` above.
 */
export function lawsBindingAt(region: { alUnits?: Record<AlUnitId, AlUnit> }, alUnitId: AlUnitId): AlLawId[] {
  const bound = new Set<AlLawId>();
  for (const unit of ancestorsOf(region, alUnitId)) for (const law of unit.laws ?? []) bound.add(law);
  return [...bound];
}

/** Whether `law` binds at `alUnitId`, adopted there or inherited from an ancestor. */
export function isBoundBy(region: { alUnits?: Record<AlUnitId, AlUnit> }, alUnitId: AlUnitId, law: AlLawId): boolean {
  return lawsBindingAt(region, alUnitId).includes(law);
}

/** Set `alUnitId`'s own succession choice, replacing any prior one — a single choice, not an adoptable set. */
export function setSuccessionLaw(alUnits: Record<AlUnitId, AlUnit>, alUnitId: AlUnitId, law: SuccessionLawId): Record<AlUnitId, AlUnit> {
  const unit = alUnits[alUnitId];
  if (!unit) return alUnits;
  return { ...alUnits, [alUnitId]: { ...unit, succession: law } };
}

/**
 * `alUnitId`'s effective succession rule (DESIGN 6c §3k-i): innermost unit
 * that set one wins, else inherit up — the opposite shape from `criminal`'s
 * union. A specific settlement's inheritance rule is one answer, not a stack;
 * `standing` if nothing in the chain ever set one, matching today's actual
 * `holderOf` behaviour unchanged.
 */
export function successionOf(region: { alUnits?: Record<AlUnitId, AlUnit> }, alUnitId: AlUnitId): SuccessionLawId {
  for (const unit of ancestorsOf(region, alUnitId)) {
    if (unit.succession) return unit.succession;
  }
  return 'standing';
}

/** The nearest AL unit both `aId` and `bId` sit inside, or null if they share none (DESIGN 6c §3e-ii). */
export function lowestCommonAlUnit(region: { alUnits?: Record<AlUnitId, AlUnit> }, aId: AlUnitId, bId: AlUnitId): AlUnit | null {
  const bChain = new Set(ancestorsOf(region, bId).map((u) => u.id));
  return ancestorsOf(region, aId).find((u) => bChain.has(u.id)) ?? null;
}

const LOCAL_RUNGS: readonly AlRung[] = ['district', 'subdistrict', 'village'];

/** Whether two AL units are close enough to walk between at the ordinary link scale (DESIGN 6c §3e-ii) — their lowest common ancestor is `district` or deeper. */
export function isLocalCrossing(region: { alUnits?: Record<AlUnitId, AlUnit> }, aId: AlUnitId, bId: AlUnitId): boolean {
  const common = lowestCommonAlUnit(region, aId, bId);
  return common !== null && LOCAL_RUNGS.includes(common.kind);
}

// Biggest to smallest; only the rungs the seat rule ties to a settlement tier.
const SEAT_RUNGS: readonly AlRung[] = ['state', 'province', 'district', 'subdistrict'];

const SEAT_RUNG_FOR_TIER: Partial<Record<SettlementTier, AlRung>> = {
  megacity: 'state', metropolis: 'province', city: 'district', town: 'subdistrict',
};

/**
 * The AL tree a floor's own places justify (DESIGN 6c §3e-i/§3e-ii): one seat
 * unit per settlement whose TIER maps to an AL rung (the seat rule) — town,
 * city, metropolis, megacity — chained biggest to smallest. Hamlet/village-tier
 * settlements and wild places get no unit of their own; they belong to the
 * smallest seat that exists, or a fallback `village` unit when none do.
 */
// ponytail: multiple settlements landing on the SAME seat rung become siblings
// all chained to the first bigger seat found, not the geographically nearest
// one — settlementBudget caps at 3/floor, so this rarely matters in practice;
// revisit if that budget grows.
export function alUnitsFor(world: Pick<World, 'seed' | 'regions'>, regionId: RegionId, places: readonly Place[]): { alUnits: Record<AlUnitId, AlUnit>; places: Place[] } {
  const alUnits: Record<AlUnitId, AlUnit> = {};
  const byRung: Partial<Record<AlRung, AlUnitId[]>> = {};

  for (const p of places) {
    if (p.kind !== 'settlement') continue;
    const tier = tierOf(world, regionId, p.id);
    const rung = tier ? SEAT_RUNG_FOR_TIER[tier] : undefined;
    if (!rung) continue;
    const id = `al-${p.id}`;
    alUnits[id] = { id, kind: rung, seat: p.id };
    (byRung[rung] ??= []).push(id);
  }

  let parentId: AlUnitId | undefined;
  for (const rung of SEAT_RUNGS) {
    const ids = byRung[rung];
    if (!ids) continue;
    for (const id of ids) if (parentId) alUnits[id] = { ...alUnits[id], parent: parentId };
    parentId = ids[0];
  }

  let mostLocalId = [...SEAT_RUNGS].reverse().map((r) => byRung[r]?.[0]).find((id): id is AlUnitId => Boolean(id));
  if (!mostLocalId) {
    mostLocalId = `al-${regionId}-village`;
    alUnits[mostLocalId] = { id: mostLocalId, kind: 'village' };
  }

  const updated = places.map((p) => ({ ...p, alUnit: alUnits[`al-${p.id}`] ? `al-${p.id}` : mostLocalId! }));
  return { alUnits, places: updated };
}
