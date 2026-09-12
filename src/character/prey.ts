import { mulberry32 } from '../engine/roll.ts';
import type { Species } from './species.ts';

/**
 * What a kind of thing HUNTS — the group's last mechanic.
 *
 * The one that makes a matchup matter rather than a ladder: templates can only
 * put creatures in order (more `str` beats less), so nothing in a stat can say
 * "this one is bad news for you in particular". A hunter's edge can, and it costs
 * no new arithmetic — the engine already has advantage, and advantage is exactly
 * the shape of being caught by something that eats your sort.
 *
 * A group hunts at most one other GROUP, of another TYPE. Not its own type,
 * because a wolf pack that hunts wolves is a different story than this mechanic
 * tells, and most groups hunt nothing at all: an edge everybody has is no edge.
 */

/** Roughly one group in three has a quarry. */
const HUNTS = 0.35;

/** What this group hunts, if anything. Seeded: a world's food chain is a fact about it. */
export function preyOf(seed: number, nodes: readonly Species[], groupId: string): string | undefined {
  const me = nodes.find((n) => n.id === groupId && n.level === 'group');
  if (!me) return undefined;

  let hash = (seed ^ 0x9e17) >>> 0;
  for (const ch of groupId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);
  if (rng() >= HUNTS) return undefined;

  const quarry = nodes.filter((n) => n.level === 'group' && n.type !== me.type);
  if (quarry.length === 0) return undefined;
  return quarry[Math.floor(rng() * quarry.length)].id;
}

/**
 * Everything that hunts this group.
 *
 * The other half, and the half a PLAYER feels: what matters to somebody choosing a
 * kind is not what they hunt but what hunts them.
 */
export const huntedBy = (seed: number, nodes: readonly Species[], groupId: string): string[] =>
  nodes
    .filter((n) => n.level === 'group' && preyOf(seed, nodes, n.id) === groupId)
    .map((n) => n.id);
