import type { Abilities, Attack, Combatant, Side, Vec } from './types.ts';

export const abilities = (over: Partial<Abilities> = {}): Abilities => ({
  str: 10, dex: 10, con: 10, agi: 10, vit: 10, int: 10, wis: 10, cha: 10, luk: 10, ...over,
});

export const sword: Attack = {
  id: 'sword', name: 'shortsword', ability: 'str', proficient: true, range: 1,
  damage: { count: 1, sides: 6, bonusAbility: 'str', type: 'slashing' },
};

export const bow: Attack = {
  id: 'bow', name: 'shortbow', ability: 'dex', proficient: true, range: 16,
  damage: { count: 1, sides: 6, bonusAbility: 'dex', type: 'piercing' },
};

export function combatant(id: string, over: Partial<Combatant> = {}): Combatant {
  return {
    id,
    name: id,
    side: 'party' as Side,
    abilities: abilities(),
    hp: 20,
    maxHp: 20,
    ac: 12,
    speed: 6,
    proficiency: 2,
    size: 'medium',
    pos: { x: 0, y: 0 } as Vec,
    conditions: [],
    attacks: [sword],
    dead: false,
    dying: false,
    deathSaves: { successes: 0, failures: 0 },
    ...over,
  };
}

/**
 * An RNG that yields exactly the d20 naturals you ask for, in order, then
 * repeats the last one. `(n - 0.5) / 20` lands squarely inside the bucket for
 * natural `n`.
 */
export function d20Sequence(...naturals: number[]): () => number {
  let i = 0;
  return () => {
    const n = naturals[Math.min(i, naturals.length - 1)];
    i++;
    return (n - 0.5) / 20;
  };
}

/** Every die rolls its maximum face. */
export const maxRolls = () => 0.999;
/** Every die rolls a 1. */
export const minRolls = () => 0;
