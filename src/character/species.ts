import { mulberry32 } from '../engine/roll.ts';
import type { Need } from './persona.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Abilities } from '../combat/types.ts';

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

/**
 * The TYPES a species belongs to — closed and authored, like every vocabulary
 * the engine resolves. A type is what differs MECHANICALLY: how its needs move,
 * and which way its body leans. The lean sums to zero, so no type is simply
 * stronger than another; it only trades one thing for another.
 */
export const TYPES = [
  { id: 'humanoid', needs: {}, lean: { cha: 2, vit: -2 } },
  { id: 'beast', needs: { purpose: 0, company: 2 }, lean: { agi: 2, int: -2 } },
  { id: 'construct', needs: { food: 0 }, lean: { con: 2, agi: -2 } },
  { id: 'undead', needs: { food: 0, rest: 0, company: 0 }, lean: { con: 2, cha: -2 } },
  { id: 'fey', needs: { safety: 2, purpose: 2 }, lean: { luk: 2, str: -2 } },
  { id: 'fiend', needs: { food: 0, company: 0 }, lean: { str: 2, wis: -2 } },
  { id: 'elemental', needs: { food: 0, rest: 0, company: 0, purpose: 0 }, lean: { vit: 2, int: -2 } },
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
  for (let i = 0; i < 2; i++) {
    const from = ABILITIES[Math.floor(rng() * ABILITIES.length)];
    const others = ABILITIES.filter((a) => a !== from);
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
  return [{ id: FOLK.id, name: FOLK.name, type: 'humanoid' as const }, ...deck.slice(0, want)].map((k) => grow(seed, k));
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
