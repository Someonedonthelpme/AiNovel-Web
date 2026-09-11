import { mulberry32 } from '../engine/roll.ts';
import type { Need } from './persona.ts';

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
};

/** The ordinary kind. Every world has it, and most people are it. */
export const FOLK: Species = { id: 'folk', name: 'folk' };

/**
 * The kinds a world may draw from.
 *
 * Setting-neutral words, the same way `subjects.ts` keeps its fallbacks neutral:
 * the SHAPES are what the engine reads, and a world's own nouns for them belong
 * to the naming pass that dresses subjects and roles.
 */
const KINDS: readonly Species[] = [
  { id: 'made', name: 'the made', needs: { food: 0 } },
  { id: 'hollow', name: 'the hollow', needs: { food: 0, rest: 0, company: 0 } },
  { id: 'beast', name: 'beasts', needs: { purpose: 0, company: 2 } },
  { id: 'touched', name: 'the touched', needs: { safety: 2, purpose: 2 } },
];

/**
 * The kinds THIS world holds.
 *
 * Dealt from a shuffled deck rather than drawn, so a world never lists one kind
 * twice — the same fix duplicate Signets and duplicate subjects both needed.
 */
export function speciesFor(seed: number): Species[] {
  const rng = mulberry32((seed ^ 0x59ec) >>> 0);
  const deck = [...KINDS].sort(() => rng() - 0.5);
  const want = 1 + Math.floor(rng() * 3);
  return [FOLK, ...deck.slice(0, want)];
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

/** How much a need moves for this kind. One when nothing says otherwise. */
export const needScale = (species: Species | undefined, need: Need): number =>
  species?.needs?.[need] ?? 1;
