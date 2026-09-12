import { mulberry32 } from '../engine/roll.ts';
import { TOWER_DEPTH } from '../items/catalogue.ts';
import type { Species } from './species.ts';

/**
 * WHERE a kind of thing lives — the group's second mechanic.
 *
 * Keyed on DEPTH, not on biome. A region's biome is a word the model invented for
 * that floor (`Region.biome` is free text), so matching a habitat to it would mean
 * matching prose, and a group that lived in "the drowned galleries" would live
 * nowhere the next time a model said "flooded halls". Depth is a number the engine
 * owns, and it is the axis the whole difficulty curve already turns on.
 *
 * A band per GROUP rather than per species: what a category is FOR is saying that
 * these creatures belong together, and things that live in the same place are the
 * clearest version of that. It is also what lets a floor's foes be ONE pack.
 */

export type Band = { from: number; to: number };

/**
 * Widths, weighted: most things keep to a stretch of the tower, and a few are
 * everywhere. A band never covers the whole tower — something that lives on every
 * floor makes depth mean nothing, which is what one flat creature list already did.
 */
const WIDTHS = [4, 5, 6, 6, 8, 10, 14];

/**
 * How deep this group lives.
 *
 * SPREAD across the tower rather than drawn freely: each group is centred on its
 * own share of the depth and jittered from there, so the whole tower is covered by
 * construction. Drawing a start at random left floor 1 and floors 25–30 with
 * nothing living on them, and only a fallback hid it — a gap the fallback covers
 * is still a floor whose inhabitants are an accident.
 */
export function bandOf(seed: number, nodes: readonly Species[], groupId: string): Band {
  const groups = nodes.filter((n) => n.level === 'group');
  const at = Math.max(0, groups.findIndex((g) => g.id === groupId));
  const share = TOWER_DEPTH / Math.max(1, groups.length);

  let hash = (seed ^ 0x4ab1) >>> 0;
  for (const ch of groupId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);

  const width = WIDTHS[Math.floor(rng() * WIDTHS.length)];
  // Centred on this group's share and jittered, so two worlds do not read the
  // same — then widened to cover that whole share. The shares tile the tower, so
  // covering yours is what makes the tower covered: jitter alone still left a gap
  // wherever two narrow bands landed apart (seed 6, floor 23).
  const centre = (at + 0.5) * share + (rng() - 0.5) * share;
  const from = Math.min(Math.max(0, Math.round(centre - width / 2)), Math.floor(at * share));
  const to = Math.max(Math.min(TOWER_DEPTH, from + width), Math.ceil((at + 1) * share));
  return { from, to: Math.min(TOWER_DEPTH, to) };
}

/** Whether this group is found on that floor. */
export const livesAt = (seed: number, nodes: readonly Species[], groupId: string, floor: number): boolean => {
  const band = bandOf(seed, nodes, groupId);
  return floor >= band.from && floor <= band.to;
};

/**
 * The groups found on a floor.
 *
 * Never empty: a floor nothing lives on would have nothing to fight, so if the
 * bands ever left a gap the NEAREST group would take it. `bandOf` spreads the
 * bands so there is no gap to cover — this is the belt to that braces, and a test
 * asserts coverage WITHOUT it, since a fallback that hides a gap is how the gap
 * survived being noticed the first time.
 */
export function groupsAt(seed: number, nodes: readonly Species[], floor: number): Species[] {
  const groups = nodes.filter((n) => n.level === 'group');
  const here = groups.filter((g) => livesAt(seed, nodes, g.id, floor));
  if (here.length > 0) return here;

  const distance = (g: Species) => {
    const band = bandOf(seed, nodes, g.id);
    return floor < band.from ? band.from - floor : floor - band.to;
  };
  const nearest = groups.slice().sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id));
  return nearest.slice(0, 1);
}

/**
 * WHICH group's population this floor draws on — a pack is one group.
 *
 * Keyed on the floor alone, so every encounter on a floor and every creature in
 * one comes out of the same population. Undefined for a world that holds no
 * kinds, which is every world stored before the tree existed.
 *
 * Lives here rather than with the fight because the population needs the same
 * answer: who lives at a place is who lives on that floor.
 */
export function packAt(seed: number, nodes: readonly Species[], floor: number): string | undefined {
  if (nodes.length === 0) return undefined;
  const groups = groupsAt(seed, nodes, floor);
  return groups[Math.floor(mulberry32((seed ^ 0xf100 ^ (floor * 31)) >>> 0)() * groups.length)]?.id;
}
