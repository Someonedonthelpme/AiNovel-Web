import type { Item } from './types.ts';

/**
 * The pieces a thing is made of.
 *
 * A sword is a blade, a guard and a handle. `instance.ts` has known how to walk
 * an assembly, weigh it, wear its weakest piece and join its silhouette since
 * the day it was written — and nothing has ever built one, so every object in
 * the game has been a single undifferentiated lump.
 *
 * THE PART TYPES ARE AUTHORED, NOT GENERATED, and that is the one thing that
 * makes this cheap. A world invents its own weapons, subjects, classes and
 * roles because the WORDS have to fit the setting; a haft is a haft in a
 * kingdom and in a wreck. So these live in one small table that every instance
 * can look up, rather than travelling with each object the way a generated
 * type has to.
 *
 * WHAT PARTS CARRY: weight, wear, shape and stats. NOT skills — a skill
 * expresses what the whole thing IS, and a handle does not know how to parry.
 */

const part = (id: string, name: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  description: '',
  kind: 'material',
  stackable: false,
  value: 2,
  weight: 1,
  ...over,
});

/**
 * Every piece the game knows how to make.
 *
 * Shapes are what make an assembly LOOK assembled: a haft is a line and a head
 * is a blob, so joining them is what makes an axe an L. A longer haft is
 * literally longer in your bag.
 */
export const PART_TYPES: Record<string, Item> = {
  haft_short: part('haft_short', 'a short haft', { shape: 'x/x', weight: 1 }),
  haft_long: part('haft_long', 'a long haft', { shape: 'x/x/x', weight: 2 }),
  grip: part('grip', 'a wrapped grip', { shape: 'x', weight: 0.5, grants: { dex: 1 } }),
  guard: part('guard', 'a crossguard', { shape: 'x', weight: 1 }),
  head_blade: part('head_blade', 'a blade', { shape: 'x/x', weight: 2, grants: { str: 1 } }),
  head_axe: part('head_axe', 'an axe head', { shape: 'x', weight: 3, grants: { str: 1 } }),
  head_point: part('head_point', 'a spearpoint', { shape: 'x', weight: 1 }),
  plate: part('plate', 'a plate', { shape: 'xx/xx', weight: 4 }),
  strap: part('strap', 'a strap', { shape: 'x', weight: 0.5 }),
};

export const partTypeOf = (typeId: string): Item | null => PART_TYPES[typeId] ?? null;

/**
 * One piece of a recipe: what it is, where it sits, and whether it comes off.
 *
 * `fused` is the boundary that bounds recursion without a depth cap. A grip
 * wound onto a handle is not swapped for a different grip — you make a new
 * handle — so it is still a part, still carries weight and wear, and simply
 * cannot be removed.
 */
export type AssemblyPart = { typeId: string; at: { x: number; y: number }; fused?: boolean };

/**
 * How a kind of thing is put together.
 *
 * Authored per archetype and looked up by the item's own slug, the same way its
 * silhouette is — `weapon_axe_d8` is an axe, and an axe is a haft and a head.
 */
const ASSEMBLIES: Record<string, AssemblyPart[]> = {
  shortsword: [
    { typeId: 'head_blade', at: { x: 0, y: 0 } },
    { typeId: 'guard', at: { x: 0, y: 2 }, fused: true },
    { typeId: 'grip', at: { x: 0, y: 3 } },
  ],
  longknife: [
    { typeId: 'head_blade', at: { x: 0, y: 0 } },
    { typeId: 'grip', at: { x: 0, y: 2 } },
  ],
  spear: [
    { typeId: 'haft_long', at: { x: 0, y: 1 } },
    { typeId: 'head_point', at: { x: 0, y: 0 } },
  ],
  axe: [
    { typeId: 'haft_short', at: { x: 0, y: 1 } },
    { typeId: 'head_axe', at: { x: 0, y: 0 } },
  ],
  sling: [
    { typeId: 'strap', at: { x: 0, y: 0 }, fused: true },
  ],
};

/*
 * LONGEST NAME WINS, for the same reason the silhouette table needs it:
 * `weapon_greataxe_d12` contains "axe", and matching in declaration order would
 * build a great-axe out of an ordinary axe's pieces.
 */
const ASSEMBLY_NAMES = Object.keys(ASSEMBLIES).sort((a, b) => b.length - a.length);

/**
 * How this particular thing is made, if the game knows.
 *
 * Nothing is required to have parts. Most objects are one piece, and an item
 * with no recipe is exactly the single lump everything used to be — which is
 * what makes this an addition rather than a migration.
 */
export function assemblyFor(item: Item): AssemblyPart[] | null {
  if (item.assembly) return item.assembly;

  const slug = item.id.toLowerCase().replace(/[^a-z]/g, '');
  for (const name of ASSEMBLY_NAMES) {
    if (slug.includes(name)) return ASSEMBLIES[name];
  }
  return null;
}
