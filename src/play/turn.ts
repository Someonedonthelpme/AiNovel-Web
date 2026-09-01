import { abilityMod } from '../combat/types.ts';
import { edgeFor } from '../skills/active.ts';
import { activeSkills } from '../session/sheet.ts';
import type { Rng } from '../engine/roll.ts';
import { roll } from '../engine/roll.ts';
import { mergeDeltas, runDirector, toWorldDelta } from '../llm/director.ts';
import type { DirectorOutput } from '../llm/director.ts';
import type { Provider } from '../llm/provider.ts';
import { assertNoLeak, toWriterView } from '../llm/redact.ts';
import { runWriter } from '../llm/writer.ts';
import type { WriterResult } from '../llm/writer.ts';
import { finalAbilities } from '../session/sheet.ts';
import { displayNames, humanise } from '../world/naming.ts';
import { activeRegion } from '../world/travel.ts';
import { applyTurn, validateDelta } from './delta.ts';
import { describeChanges } from '../character/drift.ts';
import type { AxisChange } from '../character/drift.ts';
import type { Mode, PlayState, TurnRecord, WorldDelta } from './state.ts';

/**
 * One turn, end to end.
 *
 * The order is the whole design in miniature: the Director proposes and commits
 * to every outcome, the ENGINE rolls, the engine validates what may be applied,
 * and only then does the Writer see a redacted view of the result. Nothing the
 * model says is trusted without being checked against the world first.
 */

export type TurnDeps = {
  director: Provider;
  writer: Provider;
  rng: Rng;
  /**
   * Established facts relevant to this turn — the canon guard. Injectable so
   * tests run without the embedding endpoint.
   */
  retrieveFacts?: (state: PlayState, input: string) => Promise<string[]>;
};

export type TurnResult = {
  state: PlayState;
  record: TurnRecord;
  writer: WriterResult;
  /** What the Director asked for and did not get. */
  rejected: string[];
  /** Dispositions that shifted this turn. Usually empty; a story beat when not. */
  shifts: AxisChange[];
};

/** Cheap default: the most recently established facts, no network needed. */
const recentFacts = async (state: PlayState): Promise<string[]> =>
  state.world.facts.slice(-6).map((f) => f.text);

/**
 * Legal things to do here, straight from the world.
 *
 * The "prompt or suggestion" promise costs no model call: a place already
 * declares its affordances, and its connections are already the legal moves.
 */
export function suggestedActions(state: PlayState): string[] {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  if (!place) return [];

  const moves = place.connections
    .map((id) => region?.places.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => `Go to ${p.name}`);

  const talk = place.people
    .map((id) => state.world.people[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.alive)
    .map((p) => `Talk to ${p.name}`);

  // Worlds generated before `humanisePlaces` existed still carry affordances
  // like "climb stair_tower"; these are the player's own action chips.
  const names = displayNames(region?.places ?? [], state.world.people);
  const affordances = place.affordances.map((a) => humanise(a, names));

  return [...affordances, ...talk, ...moves];
}

/**
 * A person who distrusts you resists harder. Uses trust rather than inventing
 * ability scores for every passer-by.
 */
function oppositionOf(state: PlayState, personId: string): { id: string; ability: string; modifier: number } | null {
  const person = state.world.people[personId];
  if (!person) return null;
  return { id: person.id, ability: 'resolve', modifier: Math.max(0, -person.trust) };
}

/** Pick the branch the Director committed to before the dice were thrown. */
export function outcomeFor(output: DirectorOutput, tier: 'miss' | 'partial' | 'hit') {
  if (tier === 'hit') return output.check.onHit;
  if (tier === 'partial') return output.check.onPartial;
  return output.check.onMiss;
}

export async function playTurn(
  deps: TurnDeps,
  state: PlayState,
  input: string,
  mode: Mode,
  recentTurns: string[] = [],
): Promise<TurnResult> {
  const canonFacts = await (deps.retrieveFacts ?? recentFacts)(state, input);
  const output = await runDirector(deps.director, state, input, mode, canonFacts);

  // --- resolve, in code -----------------------------------------------------
  let rolled = null as ReturnType<typeof roll> | null;
  let delta: WorldDelta = toWorldDelta(output.delta);
  let narrate: string | null = null;

  if (output.check?.required) {
    const abilities = finalAbilities(state.sheet, state.pc.inventory);
    const ability = output.check.ability as keyof typeof abilities;
    // Social and utility skills finally pay here. "Read the Ground" is worth
    // carrying because the Director asking for wisdom is when it applies.
    const edge = edgeFor(activeSkills(state.sheet), ability);
    rolled = roll(deps.rng, {
      ability: output.check.ability,
      modifier: abilityMod(abilities[ability] ?? 10) + edge,
      vs: output.check.vsPerson ? oppositionOf(state, output.check.vsPerson) : null,
    });
    const chosen = outcomeFor(output, rolled.tier);
    delta = mergeDeltas(delta, toWorldDelta(chosen.delta));
    narrate = chosen.narrate;
  }

  // --- the engine decides what is allowed -----------------------------------
  const validated = validateDelta(state, delta);
  const addressed = output.addressedPerson?.trim() || null;

  // The record is built BEFORE the prose, because the world has to move before
  // the Writer can describe it. Prose is attached afterwards.
  const draft: TurnRecord = {
    kind: 'turn',
    input,
    mode,
    classification: output.classification,
    addressed,
    roll: rolled,
    delta: validated.delta,
    rejected: validated.rejected,
    prose: '',
  };

  const applied = applyTurn(state, draft);
  const next = applied.state;

  // --- the writer sees only what the player has earned ----------------------
  // Only a conversation has a speaker; exploration is narration.
  const speaking = mode === 'conversation' && addressed && next.world.people[addressed] ? addressed : null;

  const view = toWriterView(next, {
    brief: output.brief,
    speaking,
    outcome: rolled && narrate ? { tier: rolled.tier, narrate } : null,
    recentTurns,
    canonFacts,
    shifts: describeChanges(applied.shifts),
  });
  assertNoLeak(view, next.world);

  const written = await runWriter(deps.writer, view);

  const record: TurnRecord = { ...draft, prose: written.prose };

  return { state: next, record, writer: written, rejected: validated.rejected, shifts: applied.shifts };
}
