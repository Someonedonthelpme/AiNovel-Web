import { armour, draught, material, pack, rations, weapon } from '../items/catalogue.ts';
import type { Drop, LootCategory } from '../items/catalogue.ts';
import { mulberry32 } from '../engine/roll.ts';

/**
 * The goods a player can take out of a building they hold (DESIGN 6c §3c-i).
 *
 * Only the categories the catalogue can already build an item for from a plain
 * count. `seed`, `tool` and `ingredient` have no item at all yet, and `part` and
 * `book` need more than a count — they are refused with a reason, not faked.
 */
export const COLLECTABLE = ['rations', 'draught', 'weapon', 'armour', 'pack', 'material'] as const satisfies readonly LootCategory[];
export type Collectable = (typeof COLLECTABLE)[number];

/**
 * `count` goods of one category, as items. Deterministic: the rng is a function of the
 * world's seed, the turn, and which building and category — so the fold makes the same
 * items on every replay without logging them. The same category may yield a different
 * item on a different turn.
 */
export function itemsFor(category: Collectable, count: number, seed: number, turn: number, building: string, floor: number): Drop[] {
  let hash = (seed ^ Math.imul(turn, 7919)) >>> 0;
  for (const ch of `${building}/${category}`) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const rng = mulberry32(hash);
  const each = (make: () => ReturnType<typeof weapon>): Drop[] => Array.from({ length: count }, () => ({ item: make(), count: 1 }));
  switch (category) {
    case 'rations': return [rations(count)];
    case 'draught': return [{ item: draught(floor), count }];
    case 'weapon': return each(() => weapon(rng, floor));
    case 'armour': return each(() => armour(rng, floor));
    case 'pack': return each(() => pack(rng, floor));
    case 'material': return each(() => material(rng, floor));
  }
}
