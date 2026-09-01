import type { Ability, Attack } from '../combat/types.ts';

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
