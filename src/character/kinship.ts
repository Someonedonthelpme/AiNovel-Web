import { nudgeAll, PLAYER } from '../social/edge.ts';
import type { EdgeAxis, Edges } from '../social/edge.ts';
import { groupOf } from './species.ts';
import type { Species } from './species.ts';

/**
 * Your own sort, and everybody else's — the group's third mechanic.
 *
 * A world where every stranger meets you identically has no peoples in it, only
 * costumes. Kinship is the cheapest way to make a kind MATTER socially, and it
 * costs no new machinery: edges already carry familiarity and trust, the register
 * already reads trust, so a town of your own kind speaks to you differently on the
 * very first turn.
 *
 * Three distances, and the middle one is the point. Same GROUP is kin. Another
 * group of the same TYPE is a neighbour — no warmer, no cooler, because people are
 * people. Another TYPE is a different kind of thing, and starts cooler.
 */

const KIN: Partial<Record<EdgeAxis, number>> = { familiarity: 1, trust: 1 };
const NEIGHBOUR: Partial<Record<EdgeAxis, number>> = {};
const STRANGER: Partial<Record<EdgeAxis, number>> = { trust: -1 };

/** What two kinds are to each other. Symmetric: nobody is kin one way only. */
export function kinshipOf(
  nodes: readonly Species[],
  a: string | undefined,
  b: string | undefined,
): Partial<Record<EdgeAxis, number>> {
  if (!a || !b) return NEIGHBOUR;

  const group = (id: string) => groupOf(nodes, id);
  if (group(a) && group(a) === group(b)) return KIN;

  const typeOf = (id: string) => nodes.find((n) => n.id === id)?.type;
  const mine = typeOf(a);
  const theirs = typeOf(b);
  if (!mine || !theirs) return NEIGHBOUR;
  return mine === theirs ? NEIGHBOUR : STRANGER;
}

/**
 * A cast that already knows what it thinks of you, and of each other.
 *
 * Two edges, for two different reasons. Toward the PLAYER, because how a stranger
 * meets you is the first thing a player feels. And BETWEEN people of one group,
 * because rumour travels along edges (`spreadOf`) — so kin knowing each other is
 * what makes news run through your own sort before it reaches anybody else, with
 * no second mechanism for it.
 */
export function withKin(
  base: Edges | undefined,
  nodes: readonly Species[],
  mine: string | undefined,
  cast: readonly { id: string; species?: string }[],
): Edges {
  let edges = base ?? {};

  for (const who of cast) {
    edges = nudgeAll(edges, who.id, PLAYER, kinshipOf(nodes, who.species, mine));

    for (const other of cast) {
      if (other.id === who.id) continue;
      const between = kinshipOf(nodes, who.species, other.species);
      // Only what they have in common: a town does not start out suspicious of
      // its own neighbours, and `STRANGER` toward everybody would make every
      // mixed settlement hostile before anything happened in it.
      if (between === KIN) edges = nudgeAll(edges, who.id, other.id, { familiarity: 1 });
    }
  }

  return edges;
}
