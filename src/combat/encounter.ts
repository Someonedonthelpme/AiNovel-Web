import type { Rng } from '../engine/roll.ts';
import { autoTurn } from './ai.ts';
import { startCombat } from './combat.ts';
import { cellKey } from './grid.ts';
import { makeFoe } from './statblock.ts';
import type { FoeRole, FoeSpec } from './statblock.ts';
import type { Abilities, CombatState, Combatant, Grid, Side, Vec } from './types.ts';

/**
 * What you meet on a floor, and how a fight plays out.
 *
 * Composition is derived from depth for the same reason statistics are: the
 * tower's difficulty curve is the whole progression, so it cannot be re-invented
 * per encounter by a model. The model names the creatures; this decides how many
 * and how dangerous.
 */

export const ENCOUNTER_KINDS = ['skirmish', 'boss'] as const;
export type EncounterKind = (typeof ENCOUNTER_KINDS)[number];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Every tenth floor is a landmark, and lands as a boss. */
export function kindForFloor(floor: number): EncounterKind {
  return floor > 0 && floor % 10 === 0 ? 'boss' : 'skirmish';
}

/**
 * Roles making up an encounter at this depth.
 *
 * Numbers grow slowly and quality grows instead — five weak enemies is a slog,
 * whereas two dangerous ones is a fight.
 */
export function composition(danger: number, kind: EncounterKind = 'skirmish'): FoeRole[] {
  const d = Math.max(0, danger);

  // Action economy decides solo fights. Two attackers against one character is
  // not "twice as hard", it is a loss — measured at 2% survival before this was
  // retuned. So depth raises the QUALITY of what you meet, and only adds bodies
  // once the climber has the damage to clear them.
  // A boss fights alone. Adding a minion to an already-multiplied foe was worth
  // more than the whole depth curve: floor-20 survival went from playable to 0%.
  if (kind === 'boss') return ['boss'];

  if (d < 6) return ['regular'];
  if (d < 16) return ['elite'];
  if (d < 26) return ['elite', 'minion'];
  return ['elite', 'minion', 'minion'];
}

/** Free squares near a point, so a spawn never lands in a wall or on someone. */
export function freeCellsNear(grid: Grid, origin: Vec, taken: Set<string>, count: number): Vec[] {
  const found: Vec[] = [];
  for (let radius = 0; radius <= Math.max(grid.width, grid.height) && found.length < count; radius++) {
    for (let dx = -radius; dx <= radius && found.length < count; dx++) {
      for (let dy = -radius; dy <= radius && found.length < count; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cell = { x: origin.x + dx, y: origin.y + dy };
        const key = cellKey(cell);
        if (cell.x < 0 || cell.y < 0 || cell.x >= grid.width || cell.y >= grid.height) continue;
        if (grid.walls.has(key) || taken.has(key)) continue;
        taken.add(key);
        found.push(cell);
      }
    }
  }
  return found;
}

export type EncounterOptions = {
  danger: number;
  kind?: EncounterKind;
  /** Names supplied by the model; recycled if there are more foes than names. */
  names?: string[];
  grid: Grid;
  /** Where the foes gather. */
  origin: Vec;
  taken?: Set<string>;
  /** A creature's species template, by its name. Absent: role and danger alone. */
  templateOf?: (name: string) => Partial<Abilities>;
  /** What kind of thing it is, and what it hunts, by its name. */
  kindOf?: (name: string) => { group?: string; hunts?: string };
};

export function buildEncounter(opts: EncounterOptions): Combatant[] {
  const kind = opts.kind ?? kindForFloor(opts.danger);
  const roles = composition(opts.danger, kind);
  const taken = opts.taken ?? new Set<string>();
  const cells = freeCellsNear(opts.grid, opts.origin, taken, roles.length);

  const specs: FoeSpec[] = roles.map((role, i) => {
    const name = opts.names?.length ? opts.names[i % opts.names.length] : role;
    return { id: `foe${i + 1}`, name, role, pos: cells[i] ?? opts.origin, template: opts.templateOf?.(name), ...opts.kindOf?.(name) };
  });

  return specs.map((spec) => makeFoe(spec, opts.danger));
}

export type FightResult = {
  victor: Side | 'draw' | null;
  rounds: number;
  /** Fraction of starting hit points the party still had, 0 when wiped. */
  partyHpLeft: number;
};

/**
 * Run a fight to completion with nobody steering either side.
 *
 * This is how the difficulty curve gets verified: thousands of simulated fights
 * give a win rate per floor, which is a fact rather than an opinion.
 */
export function simulateFight(rng: Rng, party: Combatant[], foes: Combatant[], grid: Grid): FightResult {
  let state: CombatState = startCombat(rng, [...party, ...foes], grid);
  const startingHp = party.reduce((sum, c) => sum + c.maxHp, 0);

  const cap = 200;
  let turns = 0;
  while (!state.over && turns < cap) {
    const before = state.turn;
    state = autoTurn(rng, state);
    turns++;
    // A turn that cannot advance would spin; bail rather than hang.
    if (state.turn === before && state.round > cap) break;
  }

  const survivingHp = Object.values(state.combatants)
    .filter((c) => c.side === 'party')
    .reduce((sum, c) => sum + Math.max(0, c.hp), 0);

  return {
    victor: state.victor,
    rounds: state.round,
    partyHpLeft: startingHp > 0 ? survivingHp / startingHp : 0,
  };
}
