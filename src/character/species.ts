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
  /** Absent on a world stored before types existed — `readSpecies` reads those. */
  type?: TypeId;
  /** Where in the tree this sits. Absent on a world stored before the tree. */
  level?: Level;
  /** The node above. A type has none. */
  parent?: string;
  /** What THIS level moved, before anything above it. */
  delta?: Partial<Abilities>;
  /** Everything down the path, summed. What a body is actually worth. */
  template?: Partial<Abilities>;
};

/** A node as a world is dealt it now: always typed, always templated. */
export type Grown = Species & {
  type: TypeId;
  level: Level;
  delta: Partial<Abilities>;
  template: Partial<Abilities>;
};

/**
 * Four levels, like *Homo sapiens sapiens*, and every living thing sits at the
 * leaf. A type is closed and authored; everything below it is dealt from the
 * seed and named by the model (6b stage 3f).
 */
export const LEVELS = ['type', 'group', 'species', 'subspecies'] as const;
export type Level = (typeof LEVELS)[number];

/** How many of each level a world deals per parent. */
const FAN: Record<Level, [number, number]> = {
  type: [3, 5], group: [2, 4], species: [1, 3], subspecies: [1, 3],
};

/**
 * How much each level moves.
 *
 * A GROUP MOVES NOTHING: its purpose is to categorise, not to be a step of
 * evolution — it carries the body plan, habitat, kinship, law standing and
 * prey it is known for instead (DESIGN 6b, group mechanics).
 */
const POINTS: Record<Level, number> = { type: 2, group: 0, species: 2, subspecies: 1 };

/** No ability on any node passes this, so nothing a world deals is unplayable. */
export const CAP = 4;

/**
 * The TYPES a species belongs to — closed and authored, like every vocabulary
 * the engine resolves. A type differs MECHANICALLY through needs: a type with no
 * safety need never flees, and with no company need it cannot be parleyed.
 *
 * Its LEAN is not authored. It is dealt per world with every other level, so the
 * same type is not the same body in two worlds — and a lean may touch any stat,
 * `vit` included. Fairness is not the goal: a body that is worse in a fight is
 * allowed, so long as the picker shows it. `CAP` is what keeps it playable.
 */
export const TYPES = [
  { id: 'humanoid', needs: {} },
  { id: 'beast', needs: { purpose: 0, company: 2 } },
  // No safety need: nothing to fear losing, so they never break (6b stage 6).
  { id: 'construct', needs: { food: 0, safety: 0 } },
  { id: 'undead', needs: { food: 0, rest: 0, company: 0, safety: 0 } },
  { id: 'fey', needs: { safety: 2, purpose: 2 } },
  { id: 'fiend', needs: { food: 0, company: 0 } },
  { id: 'elemental', needs: { food: 0, rest: 0, company: 0, purpose: 0, safety: 0 } },
  { id: 'aberration', needs: { company: 0, safety: 2 } },
] as const satisfies readonly { id: string; needs: Partial<Record<Need, number>> }[];

export type TypeId = (typeof TYPES)[number]['id'];

/** The ordinary kind. Kept for worlds stored before the tree; goes at 3g. */
export const FOLK: Species = { id: 'folk', name: 'folk', type: 'humanoid' };

/**
 * What a level moves: `points` single points, across 2–4 stats, summing to zero.
 *
 * Moving points rather than adding them is what keeps the sum at zero however
 * many levels stack, and the pool is drawn from every ability, so a species can
 * be built thick and stupid or quick and frail.
 */
function deltaOf(rng: () => number, points: number): Partial<Abilities> {
  if (points === 0) return {};

  const width = 2 + Math.floor(rng() * 3);
  const pool = [...ABILITIES].sort(() => rng() - 0.5).slice(0, width);
  const delta: Partial<Abilities> = {};
  for (let i = 0; i < points; i++) {
    const from = pool[Math.floor(rng() * pool.length)];
    const rest = pool.filter((a) => a !== from);
    const to = rest[Math.floor(rng() * rest.length)];
    delta[from] = (delta[from] ?? 0) - 1;
    delta[to] = (delta[to] ?? 0) + 1;
  }
  for (const ability of Object.keys(delta) as (keyof Abilities)[]) {
    if (delta[ability] === 0) delete delta[ability];
  }
  return delta;
}

const sum = (a: Partial<Abilities>, b: Partial<Abilities>): Partial<Abilities> => {
  const out: Partial<Abilities> = { ...a };
  for (const [ability, by] of Object.entries(b) as [keyof Abilities, number][]) {
    const total = (out[ability] ?? 0) + by;
    if (total === 0) delete out[ability];
    else out[ability] = total;
  }
  return out;
};

const within = (template: Partial<Abilities>): boolean =>
  Object.values(template).every((by) => Math.abs(by ?? 0) <= CAP);

/**
 * A delta that keeps the running total inside `CAP`.
 *
 * Redrawn rather than clamped: clamping a stat would break the zero sum that
 * makes a template a TRADE, and a level that cannot find a legal move simply
 * moves nothing — rarer than it sounds, since the pool is nine wide.
 */
function fittingDelta(rng: () => number, points: number, above: Partial<Abilities>): Partial<Abilities> {
  for (let tries = 0; tries < 12; tries++) {
    const delta = deltaOf(rng, points);
    if (within(sum(above, delta))) return delta;
  }
  return {};
}

/**
 * The tree THIS world holds, flat, parents before children.
 *
 * Flat because every reader wants one node by id — the Director naming a
 * person's kind, drift asking how a need moves, a foe asking for a body — and a
 * nested shape would make all three walk it.
 */
export function speciesFor(seed: number): Grown[] {
  const rng = mulberry32((seed ^ 0x59ec) >>> 0);
  const nodes: Grown[] = [];

  const types = [...TYPES].sort(() => rng() - 0.5);
  const howMany = (level: Level) => FAN[level][0] + Math.floor(rng() * (FAN[level][1] - FAN[level][0] + 1));

  const grow = (level: Level, parent: Grown, depth: number): void => {
    for (let i = 0; i < howMany(level); i++) {
      const id = `${parent.id}.${level[0]}${i + 1}`;
      const delta = fittingDelta(rng, POINTS[level], parent.template);
      const node: Grown = {
        id,
        // A placeholder until the model names it (3f): readable, and never shown
        // to a player as it stands.
        name: id,
        type: parent.type,
        level,
        parent: parent.id,
        delta,
        template: sum(parent.template, delta),
        ...(parent.needs ? { needs: parent.needs } : {}),
      };
      nodes.push(node);
      if (depth + 1 < LEVELS.length) grow(LEVELS[depth + 1], node, depth + 1);
    }
  };

  for (const type of types.slice(0, howMany('type'))) {
    const delta = fittingDelta(rng, POINTS.type, {});
    const node: Grown = {
      id: type.id,
      name: type.id,
      type: type.id,
      level: 'type',
      delta,
      template: delta,
      ...(Object.keys(type.needs).length ? { needs: type.needs } : {}),
    };
    nodes.push(node);
    grow('group', node, 1);
  }

  return nodes;
}

/** Whichever GROUP this node sits under — what its body plan and habitat are. */
export function groupOf(nodes: readonly Species[], id: string): string | undefined {
  let at = nodes.find((n) => n.id === id);
  while (at && at.level !== 'group') at = nodes.find((n) => n.id === at!.parent);
  return at?.id;
}

/** Every subspecies below a node, by walking ids: a tree id carries its path. */
export const leavesUnder = (nodes: readonly Species[], id: string): Species[] =>
  leavesOf(nodes).filter((leaf) => leaf.id === id || leaf.id.startsWith(`${id}.`));

/** The leaves — the subspecies, which is what a living thing actually is. */
export const leavesOf = (nodes: readonly Species[]): Species[] =>
  nodes.filter((n) => n.level === 'subspecies');

/**
 * A node as a stored world holds it.
 *
 * A world saved before the tree has neither type nor template. A tree id carries
 * its type in its first segment and its path in the rest, so the node is found by
 * dealing the same seed again — an old world reads exactly as a new one stores,
 * with no migration. An id from neither scheme was never written by this code:
 * refused, since guessing would quietly give somebody the wrong body.
 */
export function readSpecies(seed: number, stored: Species): Grown {
  if (stored.type && stored.template && stored.level) return stored as Grown;

  const dealt = speciesFor(seed).find((n) => n.id === stored.id);
  if (dealt) return { ...dealt, ...stored, type: dealt.type, level: dealt.level, delta: dealt.delta, template: dealt.template };

  const legacy = LEGACY[stored.id];
  if (!legacy) throw new Error(`species "${stored.id}" is not one any world was dealt`);
  return { ...stored, type: legacy, level: 'subspecies', delta: {}, template: {} };
}

/**
 * The five ids worlds were dealt before the tree, and what they were.
 *
 * They keep working — a stored person is that kind — but they carry no body:
 * their templates were dealt by a generator that no longer exists, and inventing
 * numbers for them would change a character somebody is already playing.
 */
const LEGACY: Record<string, TypeId> = {
  folk: 'humanoid', made: 'construct', hollow: 'undead', beast: 'beast', touched: 'fey',
};

/**
 * The kind most of this world's towns are — what `folk` used to mean.
 *
 * A world's own people rather than a global default, which is the point: one
 * world's ordinary is elves and another's is something with no name for hunger.
 * PEOPLE where there are any — a town of beasts is a bestiary, not a town — and
 * seeded, so a replay and the creation page agree without it being stored.
 */
export function dominantOf(seed: number, kinds: readonly Species[]): string {
  const leaves = leavesOf(kinds);
  if (leaves.length === 0) return FOLK.id;

  const people = leaves.filter((leaf) => leaf.type === 'humanoid');
  const from = people.length > 0 ? people : leaves;
  return from[Math.floor(mulberry32((seed ^ 0x10ad) >>> 0)() * from.length)].id;
}

/**
 * Which kind a particular person is — a SUBSPECIES, like every living thing.
 *
 * Seeded from the world and their id, so it is the same on every replay and
 * needs nothing stored to be reproducible. Weighted hard toward one kind: a town
 * where one person in four is a construct is a menagerie, not a town. WHICH kind
 * is the first leaf until 3g makes it the world's dominant one.
 */
export function speciesIdFor(seed: number, personId: string, kinds: readonly Species[] = []): string {
  const leaves = leavesOf(kinds);
  if (leaves.length === 0) return FOLK.id;

  let hash = (seed ^ 0x9e37) >>> 0;
  for (const ch of personId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);

  return rng() < 0.8 ? dominantOf(seed, kinds) : leaves[Math.floor(rng() * leaves.length)].id;
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
