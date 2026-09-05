import type { Ability, Attack } from '../combat/types.ts';
import { join, rect, shapeFrom } from './shape.ts';
import type { Shape } from './shape.ts';

/**
 * Things you carry.
 *
 * An item used to be a label — `{ id, name, description }` — which meant loot
 * could not change anything and a healing draught was indistinguishable from a
 * souvenir. The rule that matters here is the same one that governs dice and
 * combat: THE MODEL NEVER DECIDES AN EFFECT. It may say which item was used;
 * the item itself says what that does. So `effect` is a closed union, never
 * free text.
 */

export const ITEM_KINDS = ['consumable', 'equipment', 'material', 'key'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const SLOTS = ['weapon', 'armour', 'trinket'] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * What using a consumable does.
 *
 * Deliberately small and declared. Anything the engine cannot resolve
 * arithmetically has no business being an effect.
 */
export type ItemEffect =
  | { kind: 'heal'; amount: number }
  | { kind: 'cure'; condition: string }
  | { kind: 'restore'; supply: number }
  | { kind: 'buff'; ability: Ability; bonus: number; turns: number };

export type Item = {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  /** Equipment only: where it goes. */
  slot?: Slot;
  /** Consumables only. */
  effect?: ItemEffect;
  /** Weapons: what swinging it does. Replaces the background's starting attack. */
  attack?: Attack;
  /** Armour: the base it sets, before dexterity. */
  armour?: number;
  /** Trinkets and armour may nudge a score; traits gate on the total. */
  grants?: Partial<Record<Ability, number>>;
  /**
   * Which floor it came from.
   *
   * Signets gate on "a shard from floor 7 or deeper", so provenance has to
   * travel with the object rather than being inferred later.
   */
  foundOn?: number;
  /**
   * How much of your back it takes up.
   *
   * Optional, and defaulted by kind in `weightOf`, so the dozens of places that
   * build an item need not each name a number — and nothing generated is ever
   * accidentally weightless. Set it only where a thing is unusually heavy or
   * light for its kind.
   */
  weight?: number;
  /**
   * Its silhouette in a slot inventory, as a mask (see `shape.ts`).
   *
   * Optional, like `weight`, and for the same reason: `shapeOf` falls back to
   * the archetype it was generated from and then to its kind, so nothing is
   * ever shapeless. Set it only to override.
   */
  shape?: string;
  /** Whether several of these collapse into one line. */
  stackable: boolean;
  /** Rough worth, for shops and for sorting. */
  value: number;
};

/** A line in the pack: the item, and how many of it. */
export type ItemStack = { item: Item; count: number };

export type Equipped = Partial<Record<Slot, string>>;

/** The whole of what a character is carrying. */
export type Inventory = {
  stacks: ItemStack[];
  equipped: Equipped;
};

export const emptyInventory = (): Inventory => ({ stacks: [], equipped: {} });

/* -------------------------------------------------------------------------- */
/* Carrying                                                                    */
/* -------------------------------------------------------------------------- */

export const countOf = (inv: Inventory, id: string): number =>
  inv.stacks.find((s) => s.item.id === id)?.count ?? 0;

export const findItem = (inv: Inventory, id: string): Item | null =>
  inv.stacks.find((s) => s.item.id === id)?.item ?? null;

export const isEquipped = (inv: Inventory, id: string): boolean =>
  Object.values(inv.equipped).includes(id);

/**
 * Add to the pack.
 *
 * Stackable things collapse into one line; everything else takes its own, so
 * two swords with different provenance stay two swords.
 */
export function addItem(inv: Inventory, item: Item, count = 1): Inventory {
  if (count <= 0) return inv;

  if (item.stackable) {
    const at = inv.stacks.findIndex((s) => s.item.id === item.id);
    if (at >= 0) {
      const stacks = [...inv.stacks];
      stacks[at] = { ...stacks[at], count: stacks[at].count + count };
      return { ...inv, stacks };
    }
  }
  return { ...inv, stacks: [...inv.stacks, { item, count }] };
}

/**
 * Take from the pack, unequipping if the last one goes.
 *
 * Leaving a dangling equipped id would make the character wield something they
 * no longer own — and `equippedAttacks` would silently fall back, which is a
 * bug that looks like bad luck.
 */
export function removeItem(inv: Inventory, id: string, count = 1): Inventory {
  const at = inv.stacks.findIndex((s) => s.item.id === id);
  if (at < 0) return inv;

  const stack = inv.stacks[at];
  const left = stack.count - count;
  const stacks = left > 0
    ? inv.stacks.map((s, i) => (i === at ? { ...s, count: left } : s))
    : inv.stacks.filter((_, i) => i !== at);

  if (left > 0) return { ...inv, stacks };

  const equipped = { ...inv.equipped };
  for (const slot of SLOTS) if (equipped[slot] === id) delete equipped[slot];
  return { stacks, equipped };
}

/** Put something on. Only equipment, only what you actually hold. */
export function equip(inv: Inventory, id: string): { inventory: Inventory; error: string | null } {
  const item = findItem(inv, id);
  if (!item) return { inventory: inv, error: 'you are not carrying that' };
  if (item.kind !== 'equipment' || !item.slot) return { inventory: inv, error: `${item.name} is not something you can wear or wield` };
  return { inventory: { ...inv, equipped: { ...inv.equipped, [item.slot]: id } }, error: null };
}

export function unequip(inv: Inventory, slot: Slot): Inventory {
  const equipped = { ...inv.equipped };
  delete equipped[slot];
  return { ...inv, equipped };
}

/* -------------------------------------------------------------------------- */
/* What being equipped is worth                                               */
/* -------------------------------------------------------------------------- */

const equippedItems = (inv: Inventory): Item[] =>
  SLOTS.map((slot) => (inv.equipped[slot] ? findItem(inv, inv.equipped[slot]!) : null))
    .filter((i): i is Item => Boolean(i));

/** The armour base a suit sets, or null to fall back to unarmoured. */
export function equippedArmour(inv: Inventory): number | null {
  const armour = equippedItems(inv).find((i) => typeof i.armour === 'number');
  return armour?.armour ?? null;
}

/** Ability bonuses from everything worn, summed. */
export function equippedGrants(inv: Inventory): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const item of equippedItems(inv)) {
    for (const [ability, bonus] of Object.entries(item.grants ?? {})) {
      const key = ability as Ability;
      out[key] = (out[key] ?? 0) + (bonus ?? 0);
    }
  }
  return out;
}

/** The attack a wielded weapon offers, if one is wielded. */
export function equippedAttack(inv: Inventory): Attack | null {
  return equippedItems(inv).find((i) => i.attack)?.attack ?? null;
}

/* -------------------------------------------------------------------------- */
/* Load                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a thing weighs when nobody said.
 *
 * STR has claimed "carrying" since the nine stats were written and there was no
 * weight in the game at all — `stripMechanics` even deletes "Weight: 3 lbs"
 * from generated item text, correctly, because the model must not invent
 * numbers the engine uses. So the engine supplies them.
 */
const DEFAULT_WEIGHT: Record<ItemKind, number> = {
  equipment: 3,
  consumable: 1,
  material: 1,
  key: 0,
};

/** Armour is the heavy exception; everything else follows its kind. */
export const weightOf = (item: Item): number =>
  item.weight ?? (item.slot === 'armour' ? 8 : DEFAULT_WEIGHT[item.kind]);

export const carriedWeight = (inventory: Inventory): number =>
  inventory.stacks.reduce((total, stack) => total + weightOf(stack.item) * stack.count, 0);

/* -------------------------------------------------------------------------- */
/* Silhouette                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a thing looks like on a grid, ASSEMBLED FROM SQUARES.
 *
 * A haft is a line and a head is a blob; joining them is what makes a
 * one-headed axe an L and a two-headed axe a T. Building the archetypes this
 * way rather than hand-drawing each mask means a generated weapon can take its
 * silhouette from the parts it was generated with.
 */
const HAFT = (length: number) => rect(1, length);
const HEAD = (width: number) => rect(width, 1);

const ARCHETYPES: Record<string, Shape> = {
  // A blade is its own length; nothing to join.
  shortsword: rect(1, 3),
  longsword: rect(1, 5),
  dagger: rect(1, 2),
  'longknife': rect(1, 2),
  spear: rect(1, 4),
  // Haft, then a head hung off the top — the L the user described.
  axe: join(HAFT(3), HEAD(1), { x: 1, y: 0 }),
  // Two heads, one either side, and the T falls out of it.
  greataxe: join(HEAD(3), HAFT(3), { x: 1, y: 1 }),
  bow: rect(1, 4),
  sling: rect(1, 2),
};

/** Failing an archetype, a shape from what kind of thing it is. */
const KIND_SHAPES: Record<ItemKind, Shape> = {
  consumable: rect(1, 1),
  material: rect(1, 1),
  key: rect(1, 1),
  equipment: rect(2, 2),
};

/**
 * Generated ids carry their archetype — `weapon_axe_d8`, `weapon_longknife_d6`
 * — so the slug is where the silhouette comes from without anything having to
 * be authored per generated item.
 */
/*
 * LONGEST NAME WINS. `weapon_greataxe_d12` contains "axe", so scanning in
 * declaration order gave a great-axe the silhouette of an ordinary one — a
 * two-headed weapon quietly drawn as a one-headed weapon.
 */
const ARCHETYPE_NAMES = Object.keys(ARCHETYPES).sort((a, b) => b.length - a.length);

function archetypeOf(id: string): Shape | null {
  const slug = id.toLowerCase().replace(/[^a-z]/g, '');
  for (const name of ARCHETYPE_NAMES) {
    if (slug.includes(name)) return ARCHETYPES[name];
  }
  return null;
}

export function shapeOf(item: Item): Shape {
  if (item.shape) return shapeFrom(item.shape);
  const named = archetypeOf(item.id);
  if (named) return named;
  if (item.slot === 'armour') return rect(2, 3);
  return KIND_SHAPES[item.kind];
}
