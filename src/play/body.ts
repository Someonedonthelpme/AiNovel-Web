import { planFor, slotsFor } from '../character/bodyplan.ts';
import { rulesOf } from '../rules/ruleset.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { World } from '../world/types.ts';
import type { PlayState } from './state.ts';

/**
 * The ruleset as it applies to one creature's body.
 *
 * The world declares a body; a group says which parts of it this sort of creature
 * actually has (`character/bodyplan.ts`). Narrowed here, at the one seam where
 * gear meets rules, rather than inside `equip` — which takes a ruleset and has no
 * business knowing what a species is.
 *
 * A creature of no particular kind, or a world stored before bodies, gets the
 * world's body unchanged.
 */
export function bodyRulesFor(world: World, sheet: CharacterSheet): Ruleset {
  const rules = rulesOf(world);
  const kinds = world.species ?? [];
  if (!sheet.species || kinds.length === 0) return rules;

  const slots = slotsFor(rules, planFor(world.seed, kinds, sheet.species));
  return slots.length === rules.gear.slots.length ? rules : { ...rules, gear: { ...rules.gear, slots } };
}

/** The same, for a state already in play. */
export const gearRulesFor = (state: PlayState): Ruleset => bodyRulesFor(state.world, state.sheet);
