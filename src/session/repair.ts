import { ABILITIES } from '../combat/types.ts';
import type { Abilities } from '../combat/types.ts';
import { reachablePlaces } from '../world/validate.ts';
import type { Place, Region } from '../world/types.ts';
import { POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, pointBuyCost } from './sheet.ts';

/**
 * Deterministic repair of generated content.
 *
 * Models are unreliable at arithmetic and at graph invariants, and retrying is
 * slow and not guaranteed to converge. Where code can simply FIX the output —
 * an overspent point buy, a one-way corridor, an orphaned room — it should,
 * rather than bounce the generation and hope.
 *
 * Every repair is recorded so a noisy generator is visible rather than silently
 * papered over.
 */

export type Repair<T> = { value: T; repairs: string[] };

const spend = (a: Abilities): number =>
  ABILITIES.reduce((total, key) => total + (pointBuyCost(a[key]) ?? 0), 0);

/**
 * Bring proposed ability scores inside the rules: whole numbers, within the
 * buyable range, and inside the point budget. Overspend is shaved off the
 * highest score first, which preserves the shape the model was going for.
 */
export function repairAbilities(proposed: Partial<Abilities>): Repair<Abilities> {
  const repairs: string[] = [];
  const out = {} as Abilities;

  for (const key of ABILITIES) {
    const raw = proposed[key];
    let score = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 10;
    if (raw === undefined) repairs.push(`${key} was missing, defaulted to 10`);
    else if (score !== raw) repairs.push(`${key} ${raw} rounded to ${score}`);

    const clamped = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, score));
    if (clamped !== score) repairs.push(`${key} ${score} clamped to ${clamped}`);
    out[key] = clamped;
  }

  let guard = 0;
  while (spend(out) > POINT_BUY_BUDGET && guard++ < 100) {
    // Shave the highest score that can still come down.
    let target: keyof Abilities = ABILITIES[0];
    for (const key of ABILITIES) {
      if (out[key] > out[target]) target = key;
    }
    if (out[target] <= POINT_BUY_MIN) break;
    out[target] -= 1;
    repairs.push(`${target} reduced to ${out[target]} to fit the ${POINT_BUY_BUDGET}-point budget`);
  }

  return { value: out, repairs };
}

/**
 * Make a generated region playable.
 *
 * The failures that matter are structural: an edge pointing at nothing, a
 * one-way corridor, a room nobody can reach, a stair that cannot be walked to.
 * Each has a safe mechanical fix, and applying it beats rejecting the floor.
 */
export function repairRegion(region: Region): Repair<Region> {
  const repairs: string[] = [];

  // --- one id per place ---------------------------------------------------
  // The model sometimes names two places with one id. Rejecting the floor left
  // the climb with no way past (found live, floor 18), so the LATER ones are
  // renamed and keep their own connections; every other reference still means
  // the first, and the steps below link the renamed one in.
  const taken = new Set<string>();
  const unique = region.places.map((place) => {
    if (!taken.has(place.id)) {
      taken.add(place.id);
      return place;
    }
    let n = 2;
    while (taken.has(`${place.id}_${n}`)) n += 1;
    const id = `${place.id}_${n}`;
    taken.add(id);
    repairs.push(`renamed duplicate place id "${place.id}" to "${id}"`);
    return { ...place, id };
  });
  region = { ...region, places: unique };
  const byId = new Map(region.places.map((p) => [p.id, p]));

  // --- clean the edges -----------------------------------------------------
  let places: Place[] = region.places.map((place) => {
    const cleaned = [...new Set(place.connections)].filter((to) => {
      if (to === place.id) {
        repairs.push(`removed self-connection on "${place.id}"`);
        return false;
      }
      if (!byId.has(to)) {
        repairs.push(`removed connection "${place.id}" -> "${to}" (no such place)`);
        return false;
      }
      return true;
    });
    if (cleaned.length !== place.connections.length) return { ...place, connections: cleaned };
    return { ...place, connections: cleaned };
  });

  // --- make every corridor two-way ----------------------------------------
  const linkMap = new Map(places.map((p) => [p.id, new Set(p.connections)]));
  for (const place of places) {
    for (const to of place.connections) {
      const other = linkMap.get(to);
      if (other && !other.has(place.id)) {
        other.add(place.id);
        repairs.push(`made "${to}" -> "${place.id}" two-way`);
      }
    }
  }
  places = places.map((p) => ({ ...p, connections: [...(linkMap.get(p.id) ?? [])] }));

  // --- an entrance that exists --------------------------------------------
  let entrance = region.entrance;
  if (!places.some((p) => p.id === entrance)) {
    const fallback = places[0]?.id;
    if (fallback) {
      repairs.push(`entrance "${entrance}" did not exist; using "${fallback}"`);
      entrance = fallback;
    }
  }

  // --- attach anything stranded -------------------------------------------
  const working: Region = { ...region, places, entrance };
  const reachable = reachablePlaces(working);
  const stranded = places.filter((p) => !reachable.has(p.id));

  if (stranded.length > 0 && places.some((p) => p.id === entrance)) {
    places = places.map((p) => {
      if (p.id === entrance) {
        return { ...p, connections: [...new Set([...p.connections, ...stranded.map((s) => s.id)])] };
      }
      if (stranded.some((s) => s.id === p.id)) {
        return { ...p, connections: [...new Set([...p.connections, entrance])] };
      }
      return p;
    });
    for (const s of stranded) repairs.push(`connected stranded place "${s.id}" to the entrance`);
  }

  // --- a way up that can actually be walked to -----------------------------
  let exit = region.exit;
  if (exit !== null && !places.some((p) => p.id === exit)) {
    repairs.push(`exit "${exit}" did not exist; the way up is now unfound`);
    exit = null;
  }

  return { value: { ...region, places, entrance, exit }, repairs };
}

/**
 * A pronoun or particle must be a single form.
 *
 * Generators reliably answer "which particle?" with a pair like "A/B", covering
 * both genders. That string can never appear in prose, so the register check can
 * never pass. Splitting on the separator is safer than asking again.
 */
export function repairVoiceForm(raw: string): { value: string; repaired: boolean } {
  const first = (raw ?? '').split(/[\/|,;]|\s+or\s+/)[0].trim();
  return { value: first, repaired: first !== (raw ?? '').trim() };
}

export function repairVoice(voice: {
  selfPronoun: string;
  underStress: string;
  addressBands: Record<string, string>;
  particleBands: Record<string, string>;
  tics: string[];
}): Repair<typeof voice> {
  const repairs: string[] = [];

  const fix = (label: string, raw: string): string => {
    const r = repairVoiceForm(raw);
    if (r.repaired) repairs.push(`${label} "${raw}" reduced to "${r.value}"`);
    return r.value;
  };

  const bands = (label: string, record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fix(`${label}[${k}]`, v)]));

  return {
    value: {
      ...voice,
      selfPronoun: fix('selfPronoun', voice.selfPronoun),
      // Falls back to the calm form: sounding the same under pressure is better
      // than having no pronoun at all.
      underStress: fix('underStress', voice.underStress) || fix('selfPronoun', voice.selfPronoun),
      addressBands: bands('address', voice.addressBands),
      particleBands: bands('particle', voice.particleBands),
    },
    repairs,
  };
}
