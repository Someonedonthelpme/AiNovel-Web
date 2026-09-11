import { mulberry32 } from '../engine/roll.ts';
import type { Need } from './persona.ts';
import type { Abilities, Ability } from '../combat/types.ts';

/**
 * What KIND of thing somebody is.
 *
 * The persona system already carries needs per person, so a kind costs almost
 * no new machinery: it is a multiplier on how much each need MOVES for this
 * sort of creature. Absent means 1 — an ordinary person. Zero means the need
 * does not apply at all, neither draining nor able to be met, which is what
 * "a construct does not eat" has to mean if a panel is not to show a hunger
 * bar that never moves.
 *
 * Multipliers are whole numbers on purpose. Needs are integers on a 0..10
 * scale, and a fractional scale would either round back to the same number
 * (0.5 x 1 rounds to 1, changing nothing) or silently truncate to never moving
 * at all. Nought, one and two say everything this axis needs to say.
 */
export type Species = {
  id: string;
  name: string;
  needs?: Partial<Record<Need, number>>;
  /** Absent on a world stored before types existed — 6b stage 3b reads those. */
  type?: TypeId;
  /** Ability shifts from the type's lean plus this species' own; sums to zero. */
  template?: Partial<Abilities>;
};

/** A species as a world is dealt it now: always typed, always templated. */
export type Grown = Species & { type: TypeId; template: Partial<Abilities> };

const BODY: readonly Ability[] = ['str', 'dex', 'agi'];
const MIND: readonly Ability[] = ['con', 'int', 'wis', 'cha', 'luk'];

/**
 * The TYPES a species belongs to — closed and authored, like every vocabulary
 * the engine resolves. A type is what differs MECHANICALLY: how its needs move,
 * and which way its body leans. The lean sums to zero, so no type is simply
 * stronger than another; it only trades one thing for another.
 *
 * A lean trades WITHIN a group — body for body (`str dex agi`), mind for mind
 * (`con int wis cha luk`) — and never touches `vit`. A zero sum is not a fair
 * trade across groups: humanoid's first lean, `cha +2 / vit −2`, took a point of
 * HP off every default climber and 15–19 points of win rate with it.
 *
 * No lean buys `str` either: it is both to-hit and damage for a melee climber,
 * so `str +2` for `dex −2` measured +3 to +15 points of win rate. Body leans
 * trade `dex` and `agi` — and even that is not even: beast's `agi +2` measured
 * about level, construct's `agi −2` cost 5–9 points. Open in DESIGN.
 */
export const TYPES = [
  { id: 'humanoid', needs: {}, lean: { cha: 2, luk: -2 } },
  { id: 'beast', needs: { purpose: 0, company: 2 }, lean: { agi: 2, dex: -2 } },
  { id: 'construct', needs: { food: 0 }, lean: { dex: 2, agi: -2 } },
  { id: 'undead', needs: { food: 0, rest: 0, company: 0 }, lean: { con: 2, cha: -2 } },
  { id: 'fey', needs: { safety: 2, purpose: 2 }, lean: { luk: 2, con: -2 } },
  { id: 'fiend', needs: { food: 0, company: 0 }, lean: { cha: 2, wis: -2 } },
  { id: 'elemental', needs: { food: 0, rest: 0, company: 0, purpose: 0 }, lean: { con: 2, int: -2 } },
  { id: 'aberration', needs: { company: 0, safety: 2 }, lean: { int: 2, cha: -2 } },
] as const satisfies readonly { id: string; needs: Partial<Record<Need, number>>; lean: Partial<Abilities> }[];

export type TypeId = (typeof TYPES)[number]['id'];

/** The ordinary kind. Every world has it, and most people are it. */
export const FOLK: Species = { id: 'folk', name: 'folk', type: 'humanoid' };

/**
 * The kinds a world may draw from.
 *
 * Setting-neutral words, the same way `subjects.ts` keeps its fallbacks neutral:
 * the SHAPES are what the engine reads, and a world's own nouns for them belong
 * to the naming pass that dresses subjects and roles. Needs come from the type.
 */
const KINDS: readonly { id: string; name: string; type: TypeId }[] = [
  { id: 'made', name: 'the made', type: 'construct' },
  { id: 'hollow', name: 'the hollow', type: 'undead' },
  { id: 'beast', name: 'beasts', type: 'beast' },
  { id: 'touched', name: 'the touched', type: 'fey' },
];

/**
 * A species' abilities: its type's lean, then two single points moved between
 * abilities, seeded by the world and the species. Moving a point rather than
 * adding one is what keeps the sum at zero.
 */
function templateFor(seed: number, id: string, type: TypeId): Partial<Abilities> {
  let hash = (seed ^ 0x7e3a) >>> 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);

  const template: Partial<Abilities> = { ...TYPES.find((t) => t.id === type)!.lean };
  // Never vit, and never across a group — for the reasons the leans obey both.
  const movable = [...BODY, ...MIND];
  for (let i = 0; i < 2; i++) {
    const from = movable[Math.floor(rng() * movable.length)];
    const others = (BODY.includes(from) ? BODY : MIND).filter((a) => a !== from);
    const to = others[Math.floor(rng() * others.length)];
    template[from] = (template[from] ?? 0) - 1;
    template[to] = (template[to] ?? 0) + 1;
  }
  return template;
}

const grow = (seed: number, kind: { id: string; name: string; type: TypeId }): Grown => {
  const needs = TYPES.find((t) => t.id === kind.type)!.needs;
  return {
    ...kind,
    ...(Object.keys(needs).length ? { needs } : {}),
    template: templateFor(seed, kind.id, kind.type),
  };
};

const FOLK_KIND = { id: FOLK.id, name: FOLK.name, type: 'humanoid' as const };

/**
 * A species as a stored world holds it, typed and templated.
 *
 * A world saved before types existed has neither. Its ids are the ones a world
 * was dealt, so the type comes from them and the template is re-derived from the
 * same seed — an old world reads exactly as a new one stores, with no migration.
 * An untyped id outside that list was never written by this code: refused, since
 * guessing a type would quietly give somebody the wrong body.
 */
export function readSpecies(seed: number, stored: Species): Grown {
  const type = stored.type ?? [FOLK_KIND, ...KINDS].find((k) => k.id === stored.id)?.type;
  if (!type) throw new Error(`species "${stored.id}" has no type and is not a kind any world was dealt`);
  return { ...stored, type, template: stored.template ?? templateFor(seed, stored.id, type) };
}

/**
 * The kinds THIS world holds.
 *
 * Dealt from a shuffled deck rather than drawn, so a world never lists one kind
 * twice — the same fix duplicate Signets and duplicate subjects both needed.
 */
export function speciesFor(seed: number): Grown[] {
  const rng = mulberry32((seed ^ 0x59ec) >>> 0);
  const deck = [...KINDS].sort(() => rng() - 0.5);
  const want = 1 + Math.floor(rng() * 3);
  return [FOLK_KIND, ...deck.slice(0, want)].map((k) => grow(seed, k));
}

/**
 * Which kind a particular person is.
 *
 * Seeded from the world and their id, so it is the same on every replay and
 * needs nothing stored to be reproducible. Weighted hard toward the ordinary:
 * a town where one person in four is a construct is a menagerie, not a town.
 */
export function speciesIdFor(seed: number, personId: string, kinds: readonly Species[] = []): string {
  const others = kinds.filter((k) => k.id !== FOLK.id);
  if (others.length === 0) return FOLK.id;

  let hash = (seed ^ 0x9e37) >>> 0;
  for (const ch of personId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);

  return rng() < 0.8 ? FOLK.id : others[Math.floor(rng() * others.length)].id;
}

/**
 * How the climber's kind is decided at creation.
 *
 * Picked by id from the kinds this world holds, described in the player's own
 * words (the character call maps them onto one of those kinds), or left to the
 * same seeded draw every villager gets. Absent means the ordinary kind.
 */
export type SpeciesChoice = { pick: string } | { describe: string } | { decide: 'world' };

/** How much a need moves for this kind. One when nothing says otherwise. */
export const needScale = (species: Species | undefined, need: Need): number =>
  species?.needs?.[need] ?? 1;
