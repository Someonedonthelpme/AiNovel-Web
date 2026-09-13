import { simulateFight } from '../combat/encounter.ts';
import { bow, sword } from '../combat/fixtures.ts';
import type { Abilities, Grid } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { armour } from '../items/catalogue.ts';
import { addItem, emptyInventory, equip } from '../items/types.ts';
import type { Inventory } from '../items/types.ts';
import { background, sheet } from '../session/fixtures.ts';
import { derive, toCombatant } from '../session/sheet.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { flat, instant, self, single } from '../skills/effect.ts';
import type { Effect } from '../skills/effect.ts';
import { awaitingPlayer, beginEncounter, combatOptions, takeCombatAction } from './combat.ts';
import type { CombatAction } from './combat.ts';
import { applyDelta } from './delta.ts';
import { playState } from './fixtures.ts';
import type { PlayState } from './state.ts';
import { groundFloor } from '../world/fixtures.ts';
import type { Region } from '../world/types.ts';
import type { Species } from '../character/species.ts';

/**
 * A player with more than one build, for measuring what a change does.
 *
 * NOT shipped runtime: nothing in the app imports this. It exists because every
 * balance number this project had came from ONE character — a str shortsword
 * build that always took the first option offered — so a change that helped that
 * build and hurt every other one measured as an improvement. The first humanoid
 * lean cost 15–19 points of win rate before this existed.
 */

export type BuildName = 'melee' | 'ranged' | 'caster' | 'tank';
export const BUILDS: readonly BuildName[] = ['melee', 'ranged', 'caster', 'tank'];

/**
 * Four bodies that cost the same.
 *
 * Every spread sums to the same total, so a build that wins more is winning on
 * SHAPE — the only comparison worth making. Point buy is not applied: a harness
 * character is a measuring stick, not a legal climber.
 */
const SPREADS: Record<BuildName, Abilities> = {
  melee: { str: 15, dex: 11, con: 10, agi: 12, vit: 14, int: 8, wis: 10, cha: 10, luk: 10 },
  ranged: { str: 10, dex: 15, con: 10, agi: 14, vit: 11, int: 10, wis: 10, cha: 10, luk: 10 },
  caster: { str: 8, dex: 10, con: 15, agi: 11, vit: 11, int: 14, wis: 12, cha: 10, luk: 9 },
  tank: { str: 13, dex: 10, con: 10, agi: 8, vit: 16, int: 9, wis: 11, cha: 11, luk: 12 },
};

const hurt = (amount: number): Effect =>
  ({ role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape: single, duration: instant, formula: flat(amount) });

const pay = (amount: number): Effect =>
  ({ role: 'cost', sign: 'minus', channel: 'mana', who: 'own', shape: self, duration: instant, formula: flat(amount) });

/** One reaching attack, so the caster has something to cast. */
const BOLT = {
  id: 'sk_bolt', name: 'Bolt', description: 'a reaching hurt', ability: 'int' as const,
  effects: [hurt(6), pay(3)], range: 6,
};

export function buildSheet(build: BuildName, level = 1, template?: Partial<Abilities>): CharacterSheet {
  const attack = build === 'ranged' ? bow : sword;
  return sheet({
    baseAbilities: SPREADS[build],
    level,
    background: background(build, { startingAttacks: [attack], grantsSkills: [] }),
    ...(build === 'caster' ? { learned: [BOLT] } : {}),
    ...(template ? { speciesTemplate: template } : {}),
  });
}

/** What they are wearing. Only the tank bothers with a coat. */
function kitFor(build: BuildName): Inventory {
  if (build !== 'tank') return emptyInventory();
  const coat = armour(mulberry32(7), 1);
  const bag = addItem(emptyInventory(), coat);
  return equip(bag, bag.held[0].instance.id).inventory;
}

/**
 * A policy that actually plays.
 *
 * Prefers a skill when one is offered — `combatOptions` only offers what can be
 * paid for — and swings otherwise. Deliberately not the engine's `autoTurn`,
 * which knows nothing about skills (`combat/ai.ts`), so a measurement taken with
 * it says nothing about half of what a character carries.
 */
export function chooseAction(state: PlayState): CombatAction | null {
  const options = combatOptions(state);
  return options.find((o) => o.action.kind === 'skill')?.action
    ?? options.find((o) => o.action.kind === 'attack')?.action
    ?? options[0]?.action
    ?? null;
}

export const onFloor = (
  danger: number,
  seed: number,
  sheetOf: CharacterSheet,
  inventory: Inventory,
  kinds?: readonly Species[],
): PlayState => {
  const floor: Region = { ...groundFloor(), id: 'floor-h', floor: Math.max(2, danger), danger, creatures: ['a', 'b', 'c'] };
  const base = playState();
  const derived = derive(sheetOf, inventory);
  const state: PlayState = {
    ...base,
    sheet: sheetOf,
    world: {
      ...base.world, seed, turn: seed,
      // With a tree, the foes are CHARACTERS out of the floor's population;
      // without one they are statblocks, as a world stored before kinds still is.
      ...(kinds ? { species: [...kinds] } : {}),
      currentRegion: 'floor-h', regions: { 'floor-h': floor }, currentPlace: 'town',
    },
    /*
     * ITS OWN POOLS, not the fixture's. The fixture climber is level one with 11
     * hit points, and a fight opens with the lesser of what you carry in and your
     * maximum — so a level-11 sheet measured here fought on 11 of its 92, and
     * every table taken at a level above one described a body far weaker than
     * its level. Whole, because a measurement is of a fight, not of a bad day.
     */
    pc: { ...base.pc, inventory, hp: derived.maxHp, maxHp: derived.maxHp, stamina: derived.maxStamina, mana: derived.maxMana },
  };
  return applyDelta(state, { startCombat: true });
};

export type Measured = { rate: number; trials: number; hpLeft: number; actions: CombatAction[] };

/** Win rate over `trials` seeded fights, and every decision the policy took. */
export function measure(opts: {
  build: BuildName; danger: number; trials?: number; template?: Partial<Abilities>; level?: number;
  /** A world's species tree, when the foes should be characters out of it. */
  kinds?: readonly Species[];
}): Measured {
  const trials = opts.trials ?? 100;
  const sheetOf = buildSheet(opts.build, opts.level ?? 1, opts.template);
  const inventory = kitFor(opts.build);
  const actions: CombatAction[] = [];
  let wins = 0;
  let hp = 0;

  for (let seed = 0; seed < trials; seed++) {
    let state = beginEncounter(onFloor(opts.danger, seed, sheetOf, inventory, opts.kinds));
    for (let i = 0; i < 300 && state.combat && !state.combat.over; i++) {
      if (!awaitingPlayer(state)) break;
      const action = chooseAction(state);
      if (!action) break;
      actions.push(action);
      state = takeCombatAction(state, action).state;
    }
    if (state.combat?.victor === 'party') wins++;
    hp += Math.max(0, state.combat?.combatants['pc']?.hp ?? 0);
  }

  return { rate: wins / trials, trials, hpLeft: hp / trials, actions };
}

const ARENA: Grid = { width: 12, height: 12, walls: new Set<string>() };

/**
 * Who beats whom, subspecies against subspecies.
 *
 * Fighters are built from SHEETS, not statblocks: a statblock foe's hit points
 * come from danger, so `vit` — the only source of HP — would count for nothing,
 * and two subspecies differing only in it would read identical. The first version
 * of this chart did exactly that.
 *
 * ponytail: both sides run the engine's `autoTurn`, which casts nothing, so this
 * chart is about bodies. Give both sides `chooseAction` when the AI can cast
 * (step 9).
 */
export function chart(
  entries: readonly { name: string; template: Partial<Abilities> }[],
  danger = 3,
  trials = 60,
  build: BuildName = 'melee',
): number[][] {
  const of = (template: Partial<Abilities>) =>
    toCombatant(buildSheet(build, Math.max(1, Math.floor(danger / 2) + 1), template), 'x', emptyInventory());

  return entries.map((a) => entries.map((b) => {
    if (a === b) return 0.5;
    let won = 0;
    for (let i = 0; i < trials; i++) {
      // Swap sides every other fight, so the number is about bodies, not spawn.
      const first = i % 2 === 0;
      const left = { ...of(first ? a.template : b.template), id: 'L', side: 'party' as const, pos: { x: 1, y: 6 } };
      const right = { ...of(first ? b.template : a.template), id: 'R', side: 'foe' as const, pos: { x: 10, y: 6 } };
      const result = simulateFight(mulberry32(i * 7919 + 13), [left], [right], ARENA);
      if (result.victor === 'party' ? first : !first) won++;
    }
    return won / trials;
  }));
}
