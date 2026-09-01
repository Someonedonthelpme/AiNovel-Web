import type { Abilities, Attack, Combatant, Size, Vec } from './types.ts';

/**
 * Foe statistics, derived from floor depth in code.
 *
 * The model may name a monster and describe it, but it must never choose its
 * numbers: difficulty is the tower's whole progression curve, and a model asked
 * for "a tough floor-12 enemy" produces something different every time. Scaling
 * here means floor N is reliably harder than floor N-1, and that the balance can
 * be simulated rather than guessed at.
 */

export const FOE_ROLES = ['minion', 'regular', 'elite', 'boss'] as const;
export type FoeRole = (typeof FOE_ROLES)[number];

/** How much of a standard foe's durability each role carries. */
const HP_MULTIPLIER: Record<FoeRole, number> = {
  minion: 0.25,
  regular: 1,
  elite: 1.5,
  boss: 1.6,
};

/**
 * Bosses hit harder as well as lasting longer — but only a little. A role
 * multiplier is applied on top of depth scaling, so it compounds: at 3.2x HP and
 * +3 damage the floor-20 boss won 100% of simulated fights.
 */
const DAMAGE_BONUS: Record<FoeRole, number> = { minion: -2, regular: 0, elite: 1, boss: 2 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The level a character is assumed to be at this depth.
 *
 * Foe scaling is meaningless without a matching assumption about the player.
 * Progression is not implemented yet, so this is the contract the curve is
 * balanced against — when levelling arrives it must follow this shape.
 */
export function expectedPcLevel(danger: number): number {
  return clamp(1 + Math.floor(danger / 2), 1, 20);
}

export type FoeStats = {
  hp: number;
  ac: number;
  proficiency: number;
  abilities: Abilities;
  attack: Attack;
  speed: number;
};

export function scaleFoe(danger: number, role: FoeRole): FoeStats {
  const d = Math.max(0, danger);

  const physical = 10 + clamp(Math.floor(d / 2), 0, 8);
  const abilities: Abilities = {
    str: physical,
    dex: 10 + clamp(Math.floor(d / 4), 0, 6),
    con: physical,
    int: 8,
    wis: 10,
    cha: 8,
  };

  // Tuned by simulation against a SOLO climber: a regular foe should die in
  // roughly three rounds of the reference character's damage. At (8 + 5d) a
  // floor-5 fight ran ten rounds and the player lost every time.
  const hp = Math.max(1, Math.round((6 + d * 2.2) * HP_MULTIPLIER[role]));
  const ac = clamp(11 + Math.round(d / 4), 11, 19);
  // Capped deliberately: at +6 a deep foe hit the reference character 80% of the
  // time, which turned every boss into a race the player could not win.
  const proficiency = clamp(2 + Math.floor(d / 6), 2, 5);

  const attack: Attack = {
    id: 'strike',
    name: 'strike',
    ability: 'str',
    proficient: true,
    range: 1,
    damage: {
      count: clamp(1 + Math.floor(d / 8), 1, 4),
      sides: 6,
      bonusAbility: 'str',
      type: 'physical',
    },
  };

  return {
    hp,
    ac,
    proficiency,
    abilities,
    attack,
    // A boss that cannot close the distance is not a boss.
    speed: role === 'boss' ? 7 : 6,
  };
}

export type FoeSpec = {
  id: string;
  name: string;
  role: FoeRole;
  size?: Size;
  pos: Vec;
};

/** Turn a scaled role plus a name into something the combat engine can run. */
export function makeFoe(spec: FoeSpec, danger: number): Combatant {
  const stats = scaleFoe(danger, spec.role);
  return {
    id: spec.id,
    name: spec.name,
    side: 'foe',
    abilities: stats.abilities,
    hp: stats.hp,
    maxHp: stats.hp,
    ac: stats.ac,
    speed: stats.speed,
    proficiency: stats.proficiency,
    size: spec.size ?? (spec.role === 'boss' ? 'large' : 'medium'),
    pos: spec.pos,
    conditions: [],
    attacks: [stats.attack],
    dead: false,
    dying: false,
    deathSaves: { successes: 0, failures: 0 },
  };
}

/**
 * The character the difficulty curve is balanced against.
 *
 * Levelling is not implemented yet, so this is a CONTRACT rather than a
 * description: foes are tuned against this shape, and when progression arrives
 * it has to match it. Without a stated assumption about the player, "floor 12 is
 * harder" means nothing.
 */
export function referencePc(level: number, id = 'pc'): Combatant {
  const lvl = clamp(level, 1, 20);
  const str = 15 + clamp(Math.floor(lvl / 4) * 2, 0, 5);
  const abilities: Abilities = { str, dex: 13, con: 14, int: 10, wis: 12, cha: 12 };
  const hp = 12 + (lvl - 1) * 7;

  return {
    id,
    name: 'reference',
    side: 'party',
    abilities,
    hp,
    maxHp: hp,
    ac: clamp(14 + Math.floor(lvl / 6), 14, 18),
    speed: 6,
    proficiency: clamp(2 + Math.floor((lvl - 1) / 4), 2, 6),
    size: 'medium',
    pos: { x: 0, y: 0 },
    conditions: [],
    attacks: [
      {
        id: 'weapon',
        name: 'weapon',
        ability: 'str',
        proficient: true,
        range: 1,
        damage: { count: 1 + clamp(Math.floor(lvl / 5), 0, 3), sides: 8, bonusAbility: 'str', type: 'physical' },
      },
    ],
    dead: false,
    dying: false,
    deathSaves: { successes: 0, failures: 0 },
  };
}
