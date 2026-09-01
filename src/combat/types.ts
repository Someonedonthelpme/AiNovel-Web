/**
 * Tactical combat data model — D&D-like, resolved entirely in code.
 *
 * The model NEVER decides a combat outcome. It narrates a structured round log
 * the engine produced. That keeps combat deterministic, unit-testable offline,
 * free of per-round token cost, and fast.
 */

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];
export type Abilities = Record<Ability, number>;

/**
 * One ability set for the whole game: d20 + modifier resolves combat, and the
 * existing 2d6 three-tier system uses the same modifiers for social and
 * exploration checks. Two resolution systems, one character sheet.
 */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export type Vec = { x: number; y: number };

export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export const CONDITIONS = [
  'prone',
  'restrained',
  'grappled',
  'blinded',
  'poisoned',
  'stunned',
  'unconscious',
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** `roundsLeft: null` means it persists until something removes it. */
export type ActiveCondition = { kind: Condition; roundsLeft: number | null };

export type DamageRoll = {
  count: number;
  sides: number;
  /** Ability whose modifier is added to damage, if any. */
  bonusAbility: Ability | null;
  type: string;
};

export type Attack = {
  id: string;
  name: string;
  ability: Ability;
  proficient: boolean;
  /** In squares. 1 is melee reach. */
  range: number;
  damage: DamageRoll;
};

export type Side = 'party' | 'foe';

export type DeathSaves = { successes: number; failures: number };

export type Combatant = {
  id: string;
  name: string;
  side: Side;
  abilities: Abilities;
  hp: number;
  maxHp: number;
  ac: number;
  /** Movement in squares per turn. */
  speed: number;
  proficiency: number;
  size: Size;
  pos: Vec;
  conditions: ActiveCondition[];
  attacks: Attack[];
  /**
   * Party members drop to dying at 0 HP and roll death saves; foes just die.
   * `dead` is terminal in both cases.
   */
  dead: boolean;
  dying: boolean;
  deathSaves: DeathSaves;
};

/** Walls block both movement and line of sight. Keys are `${x},${y}`. */
export type Grid = {
  width: number;
  height: number;
  walls: ReadonlySet<string>;
};

export const ADVANTAGE = ['none', 'advantage', 'disadvantage'] as const;
export type AdvantageState = (typeof ADVANTAGE)[number];

export type D20Roll = {
  /** Every die rolled — two entries under advantage or disadvantage. */
  dice: number[];
  /** The die that counted. */
  natural: number;
  modifier: number;
  total: number;
  advantage: AdvantageState;
};

export type AttackResult = {
  kind: 'attack';
  attacker: string;
  target: string;
  attackName: string;
  roll: D20Roll;
  /** Natural 1 always misses, natural 20 always hits and crits. */
  hit: boolean;
  critical: boolean;
  damage: number;
  damageType: string;
  damageDice: number[];
  targetHpBefore: number;
  targetHpAfter: number;
  droppedTarget: boolean;
  killedTarget: boolean;
};

export type MoveResult = {
  kind: 'move';
  actor: string;
  from: Vec;
  to: Vec;
  cost: number;
};

export type SaveResult = {
  kind: 'save';
  actor: string;
  ability: Ability;
  dc: number;
  roll: D20Roll;
  success: boolean;
};

export type DeathSaveResult = {
  kind: 'deathSave';
  actor: string;
  roll: D20Roll;
  outcome: 'success' | 'failure' | 'criticalSuccess' | 'criticalFailure';
  saves: DeathSaves;
  stabilized: boolean;
  died: boolean;
};

export type ConditionResult = {
  kind: 'condition';
  actor: string;
  condition: Condition;
  applied: boolean;
};

export type CombatEvent =
  | AttackResult
  | MoveResult
  | SaveResult
  | DeathSaveResult
  | ConditionResult
  | { kind: 'roundStart'; round: number }
  | { kind: 'turnStart'; actor: string }
  | { kind: 'combatEnd'; victor: Side | 'draw' };

export type CombatState = {
  round: number;
  /** Index into `order`. */
  turn: number;
  /** Combatant ids in initiative order, fixed for the encounter. */
  order: string[];
  combatants: Record<string, Combatant>;
  grid: Grid;
  /** Movement squares remaining for the combatant whose turn it is. */
  movementLeft: number;
  actionUsed: boolean;
  over: boolean;
  victor: Side | 'draw' | null;
  log: CombatEvent[];
};
