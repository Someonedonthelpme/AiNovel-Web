import { shapeOf } from './types.ts';
import { join, normalise, rect } from './shape.ts';
import type { Ability } from '../combat/types.ts';
import type { Item } from './types.ts';
import type { Cell, Shape } from './shape.ts';

/**
 * A specific thing, as opposed to a kind of thing.
 *
 * `Item` is a TYPE — `weapon_axe_d8` — and `ItemStack` counts how many of one
 * you have. That works exactly as long as two of a thing are interchangeable,
 * and it stops working the moment anything can differ between them. Durability
 * broke it first: two axes at different wear are not one object with a count
 * of two. Refine levels, enchantments, rarity, a component tree and a history
 * all break it the same way.
 *
 * So: **fungibles keep stacking by type; anything that can differ becomes an
 * instance.** Nobody needs to know which ration they ate.
 *
 * AN ITEM IS A TREE. A sword is blade + guard + handle; a handle is wood +
 * cover + pommel. Parts carry stats, weight, durability and shape — but NOT
 * skills, because a skill expresses what the whole thing IS.
 *
 * The tree terminates on a FUSED boundary rather than a depth cap. A x3 scope
 * on a 30mm rail is not swapped for an x4; the assembly is recreated. Below
 * the boundary, parts were made together and are one thing.
 */

export const RARITIES = ['common', 'uncommon', 'rare', 'fine', 'storied'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Condition runs 0 (broken) to `PRISTINE`. Parts each have their own. */
export const PRISTINE = 100;

export type ItemInstance = {
  /** Unique to this object. Everything about it is keyed off this. */
  id: string;
  /** Which `Item` it is. The type carries what is true of all of them. */
  typeId: string;
  /** Wear on THIS piece. A handle can fail while the blade is fine. */
  condition: number;
  /** How far it has been refined. Stats grow with it; see `refine.ts`. */
  refine?: number;
  /**
   * How many times it has been to the smith, successes and failures alike.
   *
   * Not bookkeeping: it is what makes each ATTEMPT its own roll. Seeding the
   * roll from the level alone made a level that failed once fail for ever —
   * the same input, the same answer — so an object could be permanently stuck
   * at +2 however much was spent on it. The value of a level is still fixed by
   * the object; only the attempt is fresh.
   */
  tries?: number;
  /** Bought at refine milestones. */
  enchants?: string[];
  rarity?: Rarity;
  /**
   * This object's own history — who carried it, what it was made for.
   *
   * On the INSTANCE rather than the type, because a description belongs to a
   * kind of thing and a history belongs to one thing. Pure flavour: the model
   * writes it, and `stripMechanics` guards the line where flavour starts
   * inventing numbers.
   */
  lore?: string;
  /** Detachable parts, and where each sits in the assembly. */
  parts?: Part[];
  /**
   * Whether this piece can be taken off its parent.
   *
   * The boundary that bounds recursion. Fused parts are still parts — they
   * carry stats, weight and wear — they simply cannot be removed, so changing
   * one means recreating the assembly it belongs to.
   */
  fused?: boolean;
};

export type Part = { at: Cell; item: ItemInstance };

/** Look a type up. Passed in, so everything here stays pure. */
export type TypeOf = (typeId: string) => Item | null;

export const instanceOf = (id: string, typeId: string, over: Partial<ItemInstance> = {}): ItemInstance =>
  ({ id, typeId, condition: PRISTINE, ...over });

/* -------------------------------------------------------------------------- */
/* Walking the tree                                                            */
/* -------------------------------------------------------------------------- */

/** Every piece, the whole assembly included, parents before children. */
export function walk(inst: ItemInstance): ItemInstance[] {
  const out: ItemInstance[] = [inst];
  for (const part of inst.parts ?? []) out.push(...walk(part.item));
  return out;
}

/** The pieces that could actually be taken off, at any depth. */
export const detachable = (inst: ItemInstance): ItemInstance[] =>
  walk(inst).filter((p) => p !== inst && !p.fused);

export function findPart(inst: ItemInstance, id: string): ItemInstance | null {
  return walk(inst).find((p) => p.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* What an assembly adds up to                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The silhouette is the assembly, joined.
 *
 * A longer haft is literally longer in your bag, and a modified weapon LOOKS
 * modified. Falls back to the type's own shape for anything with no parts,
 * which is almost everything.
 */
export function shapeOfInstance(inst: ItemInstance, typeOf: TypeOf): Shape {
  const parts = inst.parts ?? [];
  const type = typeOf(inst.typeId);

  // Nothing to assemble: a thing with no pieces is simply its own shape, which
  // is almost everything.
  if (parts.length === 0) return type ? shapeOf(type) : rect(1, 1);

  /*
   * AN ASSEMBLY IS ITS PIECES, and the frame contributes nothing.
   *
   * Starting from the type's own silhouette and adding parts to it looks
   * right and is not: the archetype shape already describes the FINISHED
   * object, so a spear's 1×4 covered its haft and its point, and taking the
   * haft off left it exactly as long. Nothing could ever be seen to come
   * apart. A design that wants the frame to count lists a frame piece.
   */
  /*
   * The UNION of the pieces, each where it sits. Chaining `join` from the first
   * piece looked equivalent and was not: it silently dropped that piece's own
   * offset, so a sword with its blade taken off came out as a guard and a grip
   * with two empty squares between them.
   */
  const cells: Cell[] = [];
  for (const part of parts) {
    for (const cell of shapeOfInstance(part.item, typeOf).cells) {
      cells.push({ x: cell.x + part.at.x, y: cell.y + part.at.y });
    }
  }
  return normalise(cells);
}

/** Weight is the whole assembly — you carry the parts as well as the frame. */
export function weightOfInstance(inst: ItemInstance, typeOf: TypeOf, weightOf: (i: Item) => number): number {
  const type = typeOf(inst.typeId);
  const own = type ? weightOf(type) : 0;
  return (inst.parts ?? []).reduce((total, p) => total + weightOfInstance(p.item, typeOf, weightOf), own);
}

/**
 * How serviceable the whole thing is: its WORST piece.
 *
 * Not an average, which is the tempting choice and the wrong one — a sword
 * with a sound blade and a shattered handle is a broken sword, and averaging
 * would report it as half fine. This is the Tarkov reading, and it is what
 * makes repairing THE PART THAT FAILED the interesting action rather than
 * topping up a single bar.
 */
export function conditionOfInstance(inst: ItemInstance): number {
  return walk(inst).reduce((worst, p) => Math.min(worst, p.condition), PRISTINE);
}

/**
 * What takes the next knock.
 *
 * THE PIECES WEAR, NOT THE FRAME. Targeting the worst piece overall picks the
 * whole assembly while everything is still pristine — `walk` returns the root
 * first — so a sword would wear as one lump and the blade would never outlive
 * the handle. Preferring a part is what makes "the handle failed, the blade is
 * fine" the normal case rather than a curiosity.
 */
export function wearsFirst(inst: ItemInstance): ItemInstance {
  const pieces = walk(inst).filter((p) => p.id !== inst.id);
  if (pieces.length === 0) return inst;

  // A piece already gone takes no more of it. Without this the first thing to
  // fail stays the target for ever, and everything else on the assembly would
  // still be pristine after a hundred fights.
  const living = pieces.filter((p) => p.condition > 0);
  const takes = living.length ? living : pieces;
  return takes.reduce((worst, p) => (p.condition < worst.condition ? p : worst), takes[0]);
}

/** The piece that is letting the rest down. What a repair should target. */
export function weakestPart(inst: ItemInstance): ItemInstance {
  return walk(inst).reduce((worst, p) => (p.condition < worst.condition ? p : worst), inst);
}

/**
 * Stats are summed over the assembly. SKILLS ARE NOT.
 *
 * Damage comes from the blade and handling from the grip, so a part granting a
 * score is right. A skill expresses what the whole thing IS — it belongs to the
 * item, never to a piece of it — so nothing here reads one.
 */
export function grantsOfInstance(inst: ItemInstance, typeOf: TypeOf): Partial<Record<Ability, number>> {
  const total: Partial<Record<Ability, number>> = {};
  for (const piece of walk(inst)) {
    const grants = typeOf(piece.typeId)?.grants;
    if (!grants) continue;
    for (const [ability, bonus] of Object.entries(grants)) {
      total[ability as Ability] = (total[ability as Ability] ?? 0) + (bonus ?? 0);
    }
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Taking it apart, and putting it back                                        */
/* -------------------------------------------------------------------------- */

export type FitResult = { item: ItemInstance; error: string | null };

/**
 * Take a piece off.
 *
 * Refuses a fused piece by name rather than silently doing nothing — "you
 * would have to recreate it" is the answer, and the player should hear it.
 */
export function detach(inst: ItemInstance, partId: string): FitResult & { removed: ItemInstance | null } {
  const target = findPart(inst, partId);
  if (!target || target === inst) return { item: inst, error: 'no such part', removed: null };
  if (target.fused) return { item: inst, error: 'it was made as one piece', removed: null };

  const strip = (node: ItemInstance): ItemInstance => ({
    ...node,
    parts: (node.parts ?? []).filter((p) => p.item.id !== partId).map((p) => ({ ...p, item: strip(p.item) })),
  });
  return { item: strip(inst), error: null, removed: target };
}

/** Put a piece on, at a place in the assembly. */
export function attach(inst: ItemInstance, part: ItemInstance, at: Cell): FitResult {
  // Cycles are checked FIRST. `findPart` walks the root as well as its parts,
  // so attaching a thing to itself would otherwise be refused as "already on
  // there" — true, but the wrong reason, and the wrong thing to tell somebody.
  if (walk(part).some((p) => p.id === inst.id)) return { item: inst, error: 'a thing cannot contain itself' };
  if (findPart(inst, part.id)) return { item: inst, error: 'it is already on there' };
  return { item: { ...inst, parts: [...(inst.parts ?? []), { at, item: part }] }, error: null };
}

/** Wear one piece down. Repair is the same call with a positive amount. */
export function wear(inst: ItemInstance, partId: string, amount: number): ItemInstance {
  const touch = (node: ItemInstance): ItemInstance => ({
    ...node,
    condition: node.id === partId
      ? Math.max(0, Math.min(PRISTINE, node.condition - amount))
      : node.condition,
    parts: (node.parts ?? []).map((p) => ({ ...p, item: touch(p.item) })),
  });
  return touch(inst);
}

export const isBroken = (inst: ItemInstance): boolean => conditionOfInstance(inst) <= 0;
