import type { Ability, Attack } from '../combat/types.ts';
import { STANDARD } from '../rules/ruleset.ts';
import type { Ruleset, SlotSpec } from '../rules/ruleset.ts';
import { join, rect, shapeFrom } from './shape.ts';
import { conditionOfInstance, grantsOfInstance, instanceOf, isBroken, wear, weakestPart, weightOfInstance } from './instance.ts';
import type { ItemInstance } from './instance.ts';
import { PRISTINE } from './instance.ts';
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

/**
 * Where a thing is worn — a plain string, checked against the WORLD's slots.
 *
 * A fixed union of three could not say that this world has no boots in it, that
 * that one lets you wear two rings, or that a greatsword takes both hands. The
 * ruleset declares what a body has; an item declares what it needs; `equip` is
 * the one place the two meet.
 */
export type Slot = string;

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
  /** Equipment only: which kind of slot it needs. */
  slot?: Slot;
  /**
   * Other slots it fills as well as its own.
   *
   * How a two-hander is expressed, and generally rather than as a special case:
   * a greatsword is `slot: 'main', occupies: ['offhand']`, and a suit of plate
   * that covers the legs is `slot: 'body', occupies: ['leg']`. The engine fills
   * every one of them with the same object, so taking any of them off takes the
   * whole thing off.
   */
  occupies?: Slot[];
  /** Consumables only. */
  effect?: ItemEffect;
  /** Weapons: what swinging it does. Replaces the background's starting attack. */
  attack?: Attack;
  /** Armour: the base it sets, before dexterity. */
  armour?: number;
  /**
   * A CONTAINER, and how much it holds.
   *
   * Capacity used to be `carryBase + STR`, which meant it was a fact about your
   * body and nothing else — a pack was not a thing you could own, find, fill or
   * lose. A container is an item, so it can be all four.
   */
  capacity?: number;
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
  /**
   * This thing certainly came from somewhere.
   *
   * Most objects roll for a history and most do not get one. A keepsake is by
   * definition a thing kept for a reason, so it skips the roll.
   */
  storied?: boolean;
  /** Whether several of these collapse into one line. */
  stackable: boolean;
  /** Rough worth, for shops and for sorting. */
  value: number;
};

/** A line in the pack: the item, and how many of it. */
export type ItemStack = { item: Item; count: number };

/**
 * ONE SPECIFIC OBJECT, and the kind of thing it is.
 *
 * Stacking works exactly as long as two of a thing are interchangeable, and it
 * stops working the moment anything can differ between them. Durability broke
 * it first — two axes at different wear are not one object with a count of two
 * — and refine levels, enchantments, rarity, a component tree and a history
 * each break it the same way.
 *
 * So FUNGIBLES KEEP STACKING BY TYPE AND ANYTHING THAT CAN DIFFER BECOMES AN
 * INSTANCE. Nobody needs to know which ration they ate. `stackable` was already
 * on `Item` and already meant exactly this, so it is the discriminator rather
 * than a new one.
 *
 * The `Item` travels WITH the instance rather than being looked up, for the
 * same reason `classSpec` is carried on the sheet: a generated thing exists in
 * no global list, and regenerating one to resolve an id would let a change to
 * the generator silently rewrite what an object IS mid-run.
 */
export type Holding = {
  instance: ItemInstance;
  item: Item;
  /**
   * What is inside it, if it is a container.
   *
   * An `Inventory` again, so a bag inside a bag needs no second shape and no
   * depth limit — loot is a container you open rather than a list you are
   * handed. `putIn` refuses a cycle, which is the only thing that could make
   * the tree infinite.
   */
  contents?: Inventory;
};

/** Slot to INSTANCE id — a specific object, not a kind of one. */
export type Equipped = Partial<Record<Slot, string>>;

/** The whole of what a character is carrying. */
export type Inventory = {
  stacks: ItemStack[];
  held: Holding[];
  equipped: Equipped;
};

export const emptyInventory = (): Inventory => ({ stacks: [], held: [], equipped: {} });

/** Everything carried, of either sort, as the items they are. */
export const allItems = (inv: Inventory): Item[] =>
  [...inv.stacks.map((s) => s.item), ...inv.held.map((h) => h.item)];

/** By instance id first, then by kind — most callers only know the kind. */
/**
 * By instance id first, then by kind — most callers only know the kind.
 *
 * Searches inside containers too, so a thing in a bag is a thing you have.
 */
export function findHolding(inv: Inventory, id: string): Holding | null {
  const byInstance = inv.held.find((h) => h.instance.id === id);
  if (byInstance) return byInstance;

  for (const h of inv.held) {
    const inner = h.contents ? findHolding(h.contents, id) : null;
    if (inner) return inner;
  }
  return inv.held.find((h) => h.item.id === id) ?? null;
}

/**
 * The next free id for a thing of this type.
 *
 * Deterministic, because the fold replays. The SMALLEST unused suffix rather
 * than a count: with a count, dropping the first of two axes and picking up
 * another would mint a second object with the id the survivor already has.
 */
export function nextInstanceId(inv: Inventory, typeId: string): string {
  const taken = new Set(inv.held.map((h) => h.instance.id));
  for (let n = 0; ; n++) {
    const id = typeId + '#' + n;
    if (!taken.has(id)) return id;
  }
}

/* -------------------------------------------------------------------------- */
/* Carrying                                                                    */
/* -------------------------------------------------------------------------- */

/** How many of a KIND of thing you have, counting instances one at a time. */
export const countOf = (inv: Inventory, id: string): number =>
  (inv.stacks.find((s) => s.item.id === id)?.count ?? 0)
  + inv.held.filter((h) => h.item.id === id).length;

export const findItem = (inv: Inventory, id: string): Item | null =>
  inv.stacks.find((s) => s.item.id === id)?.item ?? findHolding(inv, id)?.item ?? null;

/** True for an instance id, and for a kind of which any one is worn. */
export const isEquipped = (inv: Inventory, id: string): boolean =>
  Object.values(inv.equipped).includes(id)
  || inv.held.some((h) => h.item.id === id && Object.values(inv.equipped).includes(h.instance.id));

/**
 * Add to the pack.
 *
 * Stackable things collapse into one line; everything else takes its own, so
 * two swords with different provenance stay two swords.
 */
export function addItem(inv: Inventory, item: Item, count = 1): Inventory {
  if (count <= 0) return inv;

  if (!item.stackable) {
    // Each one is its own object, because each one can go on to differ.
    let next = inv;
    for (let n = 0; n < count; n++) {
      const instance = instanceOf(nextInstanceId(next, item.id), item.id);
      next = { ...next, held: [...next.held, { instance, item }] };
    }
    return next;
  }

  const at = inv.stacks.findIndex((s) => s.item.id === item.id);
  if (at >= 0) {
    const stacks = [...inv.stacks];
    stacks[at] = { ...stacks[at], count: stacks[at].count + count };
    return { ...inv, stacks };
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
  if (at >= 0) {
    const stack = inv.stacks[at];
    const left = stack.count - count;
    return {
      ...inv,
      stacks: left > 0
        ? inv.stacks.map((s, i) => (i === at ? { ...s, count: left } : s))
        : inv.stacks.filter((_, i) => i !== at),
    };
  }

  // Instances go one at a time, oldest first when only the kind was named.
  let held = [...inv.held];
  const dropped: string[] = [];
  for (let n = 0; n < count; n++) {
    const found = held.findIndex((h) => h.instance.id === id || h.item.id === id);
    if (found < 0) break;
    dropped.push(held[found].instance.id);
    held = held.filter((_, i) => i !== found);
  }
  if (dropped.length === 0) return inv;

  // Leaving a dangling equipped id would make the character wield something
  // they no longer own, and `equippedAttack` would silently fall back to bare
  // hands — a bug that looks like bad luck.
  let equipped = inv.equipped;
  for (const gone of dropped) equipped = clearInstance(equipped, gone);
  return { ...inv, held, equipped };
}

/** Put something on. Only equipment, only what you actually hold. */
/** Take one object off every slot it happens to fill. */
const clearInstance = (equipped: Equipped, instanceId: string): Equipped => {
  const out: Equipped = {};
  for (const [slot, held] of Object.entries(equipped)) if (held !== instanceId) out[slot] = held;
  return out;
};

/**
 * The slot a thing of this kind should go in, preferring an empty one.
 *
 * Preferring rather than requiring, because a second ring should go on the
 * other hand and a third should replace one rather than being refused — being
 * told "both your hands are full" when you asked to put a ring on is a worse
 * game than quietly swapping.
 */
const slotFor = (equipped: Equipped, slots: readonly SlotSpec[], takes: string): SlotSpec | null => {
  const fitting = slots.filter((s) => s.takes === takes);
  return fitting.find((s) => !equipped[s.id]) ?? fitting[0] ?? null;
};

export function equip(
  inv: Inventory,
  id: string,
  rules: Ruleset = STANDARD,
): { inventory: Inventory; error: string | null } {
  const holding = findHolding(inv, id);
  if (!holding) {
    // A stackable thing is never equipment, and saying so is more use than
    // "you are not carrying that" to somebody who plainly is.
    const stacked = inv.stacks.find((s) => s.item.id === id)?.item;
    if (stacked) return { inventory: inv, error: stacked.name + ' is not something you can wear or wield' };
    return { inventory: inv, error: 'you are not carrying that' };
  }

  const { item, instance } = holding;
  if (item.kind !== 'equipment' || !item.slot) {
    return { inventory: inv, error: item.name + ' is not something you can wear or wield' };
  }

  const wanted = [item.slot, ...(item.occupies ?? [])];
  const going: SlotSpec[] = [];
  for (const takes of wanted) {
    const slot = slotFor(inv.equipped, rules.gear.slots, takes);
    // A world with no head has no helmets, and says so rather than silently
    // dropping one into nowhere.
    if (!slot) return { inventory: inv, error: 'there is nowhere on you to wear ' + item.name };
    going.push(slot);
  }

  let equipped = inv.equipped;
  // Whatever is displaced comes off ENTIRELY — a two-hander being put down by
  // the shield taking its off-hand back would otherwise stay half-wielded.
  for (const slot of going) {
    const displaced = equipped[slot.id];
    if (displaced) equipped = clearInstance(equipped, displaced);
  }
  // The SPECIFIC object, so wielding the sharp axe rather than the notched one
  // is a thing a player can do.
  for (const slot of going) equipped = { ...equipped, [slot.id]: instance.id };

  return { inventory: { ...inv, equipped }, error: null };
}

/** Take it off — and off every other slot the same object was filling. */
export function unequip(inv: Inventory, slot: Slot): Inventory {
  const held = inv.equipped[slot];
  if (!held) return inv;
  return { ...inv, equipped: clearInstance(inv.equipped, held) };
}

/* -------------------------------------------------------------------------- */
/* What being equipped is worth                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything worn, once each.
 *
 * Reads the equipped map rather than the world's slot list, which is what keeps
 * a world's slots out of the dozen places that merely LOOK at what is worn. The
 * dedupe matters: a two-hander fills two slots with one object, and counting it
 * twice would double its stats.
 */
export const equippedHoldings = (inv: Inventory): Holding[] => {
  const seen = new Set<string>();
  const out: Holding[] = [];
  for (const instanceId of Object.values(inv.equipped)) {
    if (!instanceId || seen.has(instanceId)) continue;
    seen.add(instanceId);
    const holding = findHolding(inv, instanceId);
    if (holding) out.push(holding);
  }
  return out;
};

const equippedItems = (inv: Inventory): Item[] => equippedHoldings(inv).map((h) => h.item);

/** How worn a specific object is, as a fraction. Whole things read as one. */
export const conditionIn = (inv: Inventory, id: string): number => {
  const holding = findHolding(inv, id);
  return holding ? conditionOfInstance(holding.instance) / PRISTINE : 1;
};

/** The armour base a suit sets, or null to fall back to unarmoured. */
export function equippedArmour(inv: Inventory): number | null {
  const armour = equippedHoldings(inv)
    .find((h) => typeof h.item.armour === 'number' && !isBroken(h.instance));
  return armour?.item.armour ?? null;
}

/** Ability bonuses from everything worn, summed. */
export function equippedGrants(inv: Inventory): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  for (const { instance, item } of equippedHoldings(inv)) {
    // Read off the INSTANCE, so a thing assembled from parts is worth what its
    // parts are worth — which is the whole reason parts carry stats.
    for (const [ability, bonus] of Object.entries(grantsOfInstance(instance, () => item))) {
      const key = ability as Ability;
      out[key] = (out[key] ?? 0) + (bonus ?? 0);
    }
  }
  return out;
}

/**
 * The attack a wielded weapon offers, if a WORKING one is wielded.
 *
 * `condition` is the reason instances exist at all, and this is what makes it
 * bite: a weapon worn through is no better than an empty hand. Broken rather
 * than degraded, because a blade that does nine tenths of its damage is a
 * number nobody can feel, and one that has failed is a decision.
 */
export function equippedAttack(inv: Inventory): Attack | null {
  return equippedHoldings(inv)
    .find((h) => h.item.attack && !isBroken(h.instance))?.item.attack ?? null;
}

/** Wear on everything worn — what a hard fight takes out of your gear. */
export function wearEquipped(inv: Inventory, amount: number): Inventory {
  if (amount <= 0) return inv;
  const worn = new Set(Object.values(inv.equipped));
  return {
    ...inv,
    held: inv.held.map((h) => (worn.has(h.instance.id)
      // The WEAKEST part takes it, so a handle can fail while the blade is
      // fine — which is what makes repairing a part rather than a thing mean
      // something.
      ? { ...h, instance: wear(h.instance, weakestPart(h.instance).id, amount) }
      : h)),
  };
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
  // Keyed on what MAKES a thing armour rather than on where it is worn: a
  // world may call that slot anything, and a breastplate is heavy regardless.
  item.weight ?? (typeof item.armour === 'number' ? 8 : DEFAULT_WEIGHT[item.kind]);

/**
 * What all of it weighs, all the way down.
 *
 * A full pack is heavy. Containers buy SPACE, never weightlessness — a bag that
 * made its contents free would make carrying a decision about bags rather than
 * about what you are carrying.
 */
export const carriedWeight = (inventory: Inventory): number =>
  inventory.stacks.reduce((total, stack) => total + weightOf(stack.item) * stack.count, 0)
  + inventory.held.reduce(
    // An assembly weighs what it is made of, so a longer haft is heavier.
    (total, h) => total + weightOfInstance(h.instance, () => h.item, weightOf)
      + (h.contents ? carriedWeight(h.contents) : 0),
    0,
  );

/* -------------------------------------------------------------------------- */
/* Containers                                                                  */
/* -------------------------------------------------------------------------- */

export const isContainer = (item: Item): boolean => (item.capacity ?? 0) > 0;

/** What is still free inside one. */
export const spaceIn = (holding: Holding): number =>
  (holding.item.capacity ?? 0) - carriedWeight(holding.contents ?? emptyInventory());

/** Every container carried, at any depth, so a bag inside a bag is findable. */
export function containersIn(inv: Inventory): Holding[] {
  return inv.held.flatMap((h) => (
    isContainer(h.item) ? [h, ...containersIn(h.contents ?? emptyInventory())] : []
  ));
}

/** Whether `id` is this container or anything inside it — the cycle guard. */
function within(holding: Holding, id: string): boolean {
  if (holding.instance.id === id) return true;
  return (holding.contents?.held ?? []).some((h) => within(h, id));
}

/**
 * Rebuild the tree with one container replaced.
 *
 * The whole of the recursion, in one place: everything else here says WHAT to
 * change and this says how to put the tree back together around it.
 */
function replacing(inv: Inventory, id: string, change: (h: Holding) => Holding): Inventory {
  return {
    ...inv,
    held: inv.held.map((h) => {
      if (h.instance.id === id) return change(h);
      if (!h.contents) return h;
      return { ...h, contents: replacing(h.contents, id, change) };
    }),
  };
}

/** Take one thing out of wherever it is, anywhere in the tree. */
function lift(inv: Inventory, id: string): { inventory: Inventory; taken: Holding | null } {
  const at = inv.held.findIndex((h) => h.instance.id === id);
  if (at >= 0) {
    return {
      inventory: { ...inv, held: inv.held.filter((_, i) => i !== at) },
      taken: inv.held[at],
    };
  }
  for (const [i, h] of inv.held.entries()) {
    if (!h.contents) continue;
    const inner = lift(h.contents, id);
    if (!inner.taken) continue;
    const held = [...inv.held];
    held[i] = { ...h, contents: inner.inventory };
    return { inventory: { ...inv, held }, taken: inner.taken };
  }
  return { inventory: inv, taken: null };
}

export type MoveResult = { inventory: Inventory; error: string | null };

/**
 * Put something into a container.
 *
 * Refuses three things, each of which would otherwise produce a bag that is
 * wrong rather than full: something that will not fit, a bag put inside itself,
 * and a bag put inside one of its own pockets.
 */
export function putIn(inv: Inventory, itemId: string, containerId: string): MoveResult {
  const container = findHolding(inv, containerId);
  if (!container || !isContainer(container.item)) {
    return { inventory: inv, error: 'that is not something you can put things in' };
  }
  const moving = findHolding(inv, itemId);
  if (!moving) return { inventory: inv, error: 'you are not carrying that' };
  if (within(moving, container.instance.id)) {
    return { inventory: inv, error: container.item.name + ' will not go inside itself' };
  }
  if (Object.values(inv.equipped).includes(moving.instance.id)) {
    return { inventory: inv, error: 'take ' + moving.item.name + ' off first' };
  }

  const bulk = weightOfInstance(moving.instance, () => moving.item, weightOf)
    + (moving.contents ? carriedWeight(moving.contents) : 0);
  if (bulk > spaceIn(container)) {
    return { inventory: inv, error: moving.item.name + ' will not fit in ' + container.item.name };
  }

  const { inventory: without, taken } = lift(inv, moving.instance.id);
  if (!taken) return { inventory: inv, error: 'you are not carrying that' };

  return {
    inventory: replacing(without, container.instance.id, (h) => ({
      ...h,
      contents: { ...(h.contents ?? emptyInventory()), held: [...(h.contents?.held ?? []), taken] },
    })),
    error: null,
  };
}

/** Take something back out, into your own hands. */
export function takeOut(inv: Inventory, itemId: string): MoveResult {
  const at = inv.held.findIndex((h) => h.instance.id === itemId);
  if (at >= 0) return { inventory: inv, error: 'that is already in your hands' };

  const { inventory, taken } = lift(inv, itemId);
  if (!taken) return { inventory: inv, error: 'you are not carrying that' };
  return { inventory: { ...inventory, held: [...inventory.held, taken] }, error: null };
}

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
  if (typeof item.armour === 'number') return rect(2, 3);
  return KIND_SHAPES[item.kind];
}
