import type { Abilities } from '../combat/types.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { NodeGrant, SkillNode, SkillTree } from './skilltree.ts';
import { conditionMet } from './traits.ts';
import type { TraitContext } from './traits.ts';

/**
 * Spending points on the tree.
 *
 * The contiguity rule is the whole mechanic: a node may only be taken if it
 * touches one you already hold. Without it the tree is a shopping list and
 * every character buys the same four keystones; with it, reaching something far
 * out means paying for the route, and the route IS the build.
 *
 * Hidden nodes are checked here too. A node whose requirements are unmet is not
 * merely unaffordable — as far as the player is concerned it does not exist,
 * which is what makes the tree grow as the character does.
 */

export type Allocation = {
  /** Node ids taken, always including the start. */
  taken: string[];
};

export const START_ALLOCATION = (tree: SkillTree): Allocation => ({ taken: [tree.start] });

export const isTaken = (allocation: Allocation, id: string): boolean => allocation.taken.includes(id);

/** A node is visible once every requirement on it holds. */
export const isVisible = (node: SkillNode, ctx: TraitContext): boolean =>
  (node.requires ?? []).every((c) => conditionMet(c, ctx));

/** Only what the player is allowed to see. Hidden nodes are omitted entirely. */
export function visibleNodes(tree: SkillTree, ctx: TraitContext): SkillNode[] {
  return tree.nodes.filter((n) => isVisible(n, ctx));
}

export type AllocationCheck = { ok: boolean; reason: string | null };

/**
 * Whether a point can go here.
 *
 * Order matters for the message the player sees: "you cannot reach that yet" is
 * a different problem from "you have no points", and conflating them makes the
 * tree feel broken rather than gated.
 */
export function canAllocate(
  tree: SkillTree,
  allocation: Allocation,
  ctx: TraitContext,
  nodeId: string,
): AllocationCheck {
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: 'no such node' };
  if (isTaken(allocation, nodeId)) return { ok: false, reason: 'you already have that' };
  if (!isVisible(node, ctx)) return { ok: false, reason: 'no such node' };

  if (!entryOpen(node, allocation)) {
    return {
      ok: false,
      reason: node.requiresAll?.length
        ? 'that opens only when several parts of your tree meet'
        : 'you have not reached that part of the tree yet',
    };
  }

  if ((ctx.sheet.skillPoints ?? 0) <= 0) return { ok: false, reason: 'you have no skill points to spend' };
  return { ok: true, reason: null };
}

/**
 * The three ways into a node.
 *
 * PARALLEL needs nothing held — whatever grew the branch already paid for the
 * way in. COMBINATION needs every listed node, which is the only case on the
 * tree where "adjacent" is not enough. Everything else is ordinary contiguity:
 * any one neighbour.
 */
export function entryOpen(node: SkillNode, allocation: Allocation): boolean {
  if (node.freeStanding) return true;
  if (node.requiresAll?.length) return node.requiresAll.every((id) => isTaken(allocation, id));
  return node.connections.some((id) => isTaken(allocation, id));
}

export type AllocateResult = { sheet: CharacterSheet; error: string | null; node: SkillNode | null };

/**
 * Take a node.
 *
 * The aggregate is recomputed here, in the same call that changes `allocated`.
 * Keeping the two in one place is deliberate: a cached total that can be
 * updated independently of what it summarises is the same shape of bug as a
 * snapshot that drops half the fold.
 */
export function allocate(tree: SkillTree, ctx: TraitContext, nodeId: string): AllocateResult {
  const allocation = allocationOf(ctx.sheet, tree);
  const check = canAllocate(tree, allocation, ctx, nodeId);
  if (!check.ok) return { sheet: ctx.sheet, error: check.reason, node: null };

  const taken = [...allocation.taken, nodeId];
  const node = tree.nodes.find((n) => n.id === nodeId) ?? null;

  // A notable TEACHES. Folding it into `learned` here keeps every active in
  // one list, so nothing downstream has to know whether a skill came from a
  // background, a book, or a point spent on the tree.
  const learned = [...(ctx.sheet.learned ?? [])];
  if (node?.teaches && !learned.some((s) => s.id === node.teaches!.id)) learned.push(node.teaches);

  return {
    sheet: {
      ...ctx.sheet,
      allocated: taken,
      skillPoints: (ctx.sheet.skillPoints ?? 0) - 1,
      treeBonuses: totalGrant(tree, taken),
      learned,
    },
    error: null,
    node,
  };
}

/** What the sheet currently holds, defaulting to just the start. */
export const allocationOf = (sheet: CharacterSheet, tree: SkillTree): Allocation => ({
  taken: sheet.allocated?.length ? sheet.allocated : [tree.start],
});

/* -------------------------------------------------------------------------- */
/* What the tree is worth                                                      */
/* -------------------------------------------------------------------------- */

export type TreeBonuses = {
  ability: Partial<Abilities>;
  maxHp: number;
  ac: number;
  attack: number;
  damage: number;
};

export const noBonuses = (): TreeBonuses => ({ ability: {}, maxHp: 0, ac: 0, attack: 0, damage: 0 });

const applyGrant = (into: TreeBonuses, grant: NodeGrant, sign: 1 | -1): void => {
  for (const [ability, bonus] of Object.entries(grant.ability ?? {})) {
    const key = ability as keyof Abilities;
    into.ability[key] = (into.ability[key] ?? 0) + sign * (bonus ?? 0);
  }
  into.maxHp += sign * (grant.maxHp ?? 0);
  into.ac += sign * (grant.ac ?? 0);
  into.attack += sign * (grant.attack ?? 0);
  into.damage += sign * (grant.damage ?? 0);
};

/** Everything the taken nodes add up to, keystone costs included. */
export function totalGrant(tree: SkillTree, taken: readonly string[]): TreeBonuses {
  const total = noBonuses();
  const held = new Set(taken);

  for (const node of tree.nodes) {
    if (!held.has(node.id)) continue;
    applyGrant(total, node.grant, 1);
    if (node.cost) applyGrant(total, node.cost, -1);
  }
  return total;
}

/**
 * Rebuild the aggregate from scratch.
 *
 * The safety net for the cache above: anything that changes `allocated` outside
 * `allocate` can call this rather than leaving the total stale.
 */
export const refreshBonuses = (sheet: CharacterSheet, tree: SkillTree): CharacterSheet => ({
  ...sheet,
  treeBonuses: totalGrant(tree, allocationOf(sheet, tree).taken),
});
