import { mulberry32 } from '../engine/roll.ts';
import type { Ruleset, SlotSpec } from '../rules/ruleset.ts';
import type { Species, TypeId } from './species.ts';

/**
 * What a body is SHAPED like, and therefore what it can wear and wield.
 *
 * The group's mechanic, and the one place a category earns its keep: a group
 * carries no stats (DESIGN 6b — it categorises rather than evolving), but it does
 * say whether this sort of creature has hands.
 *
 * The hook was already waiting. `items/types.ts` says it plainly: "The ruleset
 * declares what a body has; an item declares what it needs; `equip` is the one
 * place the two meet." Until now one body served a whole world, so every creature
 * in it wore boots.
 *
 * A plan REMOVES slots rather than declaring its own, so a world that adds a slot
 * (a world of four-armed people) gets it everywhere without every plan being
 * rewritten — and a plan that removes nothing is exactly today's behaviour.
 */

export type PlanId = 'upright' | 'beastly' | 'winged' | 'serpentine';

export const BODY_PLANS: Record<PlanId, { without: readonly string[]; of: string }> = {
  /** Two hands, two feet, and somewhere to hang a pack. People, and most made things. */
  upright: { without: [], of: 'stands and carries' },
  /** Four legs and a mouth. No hands to hold anything, no feet to put boots on. */
  beastly: { without: ['main', 'offhand', 'foot'], of: 'runs on all fours' },
  /** Wings fill the back, so nothing is strapped to it — a pack is a pack of nothing. */
  winged: { without: ['back'], of: 'flies' },
  /** No legs at all. Hands, though, which is what makes it worse than a beast. */
  serpentine: { without: ['leg', 'foot'], of: 'coils' },
};

/**
 * Which plans each type may be shaped like.
 *
 * Authored, because this is a vocabulary and not a draw: the point of a type is
 * that a wolf cannot come out upright with a sword in its hand.
 */
const PLANS_OF: Record<TypeId, readonly PlanId[]> = {
  humanoid: ['upright', 'upright', 'winged', 'serpentine'],
  beast: ['beastly', 'beastly', 'winged', 'serpentine'],
  construct: ['upright', 'upright', 'beastly'],
  undead: ['upright', 'upright', 'serpentine'],
  fey: ['upright', 'winged', 'winged', 'serpentine'],
  fiend: ['upright', 'winged', 'beastly'],
  elemental: ['upright', 'winged', 'serpentine'],
  aberration: ['serpentine', 'beastly', 'winged', 'upright'],
};

/**
 * The body of whatever this id names — its GROUP's body.
 *
 * A species and a lineage inherit it: a body plan is what the category is FOR,
 * and two lineages of one people having different numbers of hands would make the
 * group mean nothing. Seeded, so nothing is stored and a replay agrees.
 *
 * An id the tree does not hold — a world saved before bodies existed — is
 * `upright`, which removes nothing and leaves the world's own body untouched.
 */
export function planFor(seed: number, nodes: readonly Species[], id: string): PlanId {
  let at = nodes.find((n) => n.id === id);
  while (at && at.level !== 'group') at = nodes.find((n) => n.id === at!.parent);
  if (!at?.type) return 'upright';

  let hash = (seed ^ 0xb0d1) >>> 0;
  for (const ch of at.id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const allowed = PLANS_OF[at.type];
  return allowed[Math.floor(mulberry32(hash)() * allowed.length)];
}

/** The world's body, less whatever this shape does not have. */
export const slotsFor = (rules: Ruleset, plan: PlanId): SlotSpec[] =>
  rules.gear.slots.filter((slot) => !BODY_PLANS[plan].without.includes(slot.takes));
