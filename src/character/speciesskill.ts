import { mulberry32 } from '../engine/roll.ts';
import { composeSkill } from '../skills/compose.ts';
import type { Grammar, PayloadKind } from '../skills/compose.ts';
import { STAT_GRAMMAR } from '../skills/statgrammar.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';
import type { Grown, TypeId } from './species.ts';

/**
 * What a kind of being can DO, on top of what its body is worth.
 *
 * Three levels, three jobs, and none of them a model's to decide:
 *
 *   type         the GRAMMAR — what sort of thing its creatures may ever do.
 *                A wolf has no spellcraft and the dead do not mend.
 *   species      one SIGNATURE skill, composed from the stat its body leans on.
 *   subspecies   a VARIANT of it: the same knack, bent by a different budget.
 *
 * `composeSkill` already does the hard half, deterministically and inside a
 * grammar, so this is a narrowing and a seed rather than a generator.
 */

/**
 * How a type narrows the stat grammar.
 *
 * A FILTER over payloads, never a replacement: the stat still decides what a
 * payload MEANS (`hinder` on STR pins, on CHA it frightens), and the type
 * decides which of them this sort of creature could ever reach for. Absent means
 * a type narrows nothing — which is what being ordinary people amounts to.
 */
export const TYPE_GRAMMAR: Partial<Record<TypeId, { payloads?: PayloadKind[] }>> = {
  // Tooth, claw and weight. Nothing thrown, nothing mended.
  beast: { payloads: ['strike', 'hinder', 'special'] },
  // Made things endure and they break what is in front of them; they do not heal.
  construct: { payloads: ['strike', 'hinder', 'edge', 'burst'] },
  // What is dead takes, and frightens. It never mends anything, itself included.
  undead: { payloads: ['drain', 'hex', 'hinder', 'strike'] },
  // Bargains and glamour: it turns things aside rather than breaking them.
  fey: { payloads: ['hex', 'hinder', 'special', 'rally', 'mend'] },
  fiend: { payloads: ['drain', 'hex', 'strike', 'burst'] },
  elemental: { payloads: ['burst', 'strike', 'edge'] },
  aberration: { payloads: ['hex', 'special', 'drain', 'hinder'] },
};

/**
 * The grammar a creature of this type composes within, for this stat.
 *
 * The stat's grammar with the type's filter applied. The narrowing is absolute:
 * a beast never bursts however its body leans, because a wolf having no
 * spellcraft is the point of having types at all. Where a stat and a type share
 * nothing the answer is an EMPTY payload list, and `knackOf` is what makes sure
 * no creature is ever asked to compose from one.
 */
export function grammarFor(type: TypeId, ability: Ability): Grammar {
  const stat = STAT_GRAMMAR[ability];
  const allowed = TYPE_GRAMMAR[type]?.payloads;
  if (!allowed) return stat;

  return { ...stat, payloads: stat.payloads.filter((p) => allowed.includes(p)) };
}

/**
 * The stat a body leans hardest on — among the ones its KIND can actually use.
 *
 * A beast whose body leans on INT does not get spellcraft for it; it gets the
 * best of what a beast may do. Narrowing the stat rather than widening the
 * grammar is what keeps "the dead do not mend" true without leaving any kind
 * unable to compose a skill at all. Ties break on the ability order.
 */
export function knackOf(node: Grown): Ability {
  const usable = ABILITIES.filter((ability) => grammarFor(node.type, ability).payloads.length > 0);
  const from = usable.length > 0 ? usable : ABILITIES;

  let best: Ability = from[0];
  let by = -Infinity;
  for (const ability of from) {
    const shift = node.template[ability] ?? 0;
    if (shift > by) { best = ability; by = shift; }
  }
  return best;
}

/**
 * What a budget buys at each level.
 *
 * A species' skill is the headline; a lineage's is the same knack bent — a
 * little richer or a little thinner, which is enough to make it a different
 * skill without making it a different idea. `composeSkill` draws a standing
 * bonus rather than an action below 6, so both stay above that.
 */
const BUDGET: Record<'species' | 'subspecies', number> = { species: 10, subspecies: 8 };

/**
 * One skill for this node, the same on every replay.
 *
 * Seeded from the world and the node's id, never from a live roll: a kind's
 * signature is a fact about the world, like its name, and a fold that composed a
 * different one on reload would break the contract that the log is truth.
 */
export function signatureSkill(seed: number, node: Grown): ActiveSkill {
  const level = node.level === 'subspecies' ? 'subspecies' : 'species';
  const ability = knackOf(node);

  let hash = (seed ^ 0x5c11) >>> 0;
  for (const ch of node.id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;

  return composeSkill(mulberry32(hash), {
    id: `sp_${node.id}`,
    // Blank, so the composer names it in the play language. The model names the
    // KIND (3f); what its knack is called is the composer's own vocabulary.
    name: '',
    description: `what ${node.name} can do`,
    ability,
    grammar: grammarFor(node.type, ability),
    budget: BUDGET[level],
  });
}
