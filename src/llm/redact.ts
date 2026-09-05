import type { Tier } from '../engine/roll.ts';
import { dispositionOf } from '../character/persona.ts';
import { describeMental, describePersonality } from '../character/persona.ts';
import type { PlayState } from '../play/state.ts';
import { activeRegion } from '../world/travel.ts';
import type { World } from '../world/types.ts';
import { displayNames, humanise } from '../world/naming.ts';
import { registerForPerson } from './register.ts';
import { PLAYER, trustToward } from '../social/edge.ts';
import { beliefsAbout } from '../social/deed.ts';
import type { RegisterInstruction } from './register.ts';

/**
 * The redaction boundary.
 *
 * The design has claimed from the start that spoiler-proofing is STRUCTURAL
 * rather than a prompt-engineering hope. This is where that becomes literally
 * true: `WriterView` has no `World`, no undiscovered places, no facts the player
 * has not established. Because `writer.ts` accepts only a `WriterView`, handing
 * it world state is a compile error rather than a code-review note.
 *
 * `assertNoLeak` backs that up at runtime, because a type only protects the code
 * paths the compiler can see.
 */

export type WriterBrief = {
  /** What should happen in this passage. */
  intent: string;
  /** Details the passage must contain — deliberate foreshadowing lives here. */
  mustInclude: string[];
  /** Things the passage must not mention. */
  mustNotMention: string[];
  tone: string;
  length: 'short' | 'medium';
};

export type PresentPerson = {
  id: string;
  name: string;
  oneLine: string;
  /** Pronounced traits only — a neutral disposition is not worth saying. */
  disposition: string[];
  /** How they are holding up, when it is worth remarking on. */
  condition: string[];
  /** Emitted every turn. Register is the first constraint a model drops. */
  register: RegisterInstruction;
  /**
   * What this person THINKS the player has done, and how sure they are.
   *
   * Belief, never fact. Somebody who half-heard a story should write like
   * somebody who half-heard a story — and a person holding something FALSE has
   * to be written holding it, or the correction arc has nowhere to happen.
   */
  believes: string[];
};

export type WriterView = {
  language: 'th' | 'en';
  place: { name: string; description: string; affordances: string[] };
  peoplePresent: PresentPerson[];
  /**
   * The Writer knew a name and a pronoun — less than it knew about any villager
   * in the room, who came with a disposition and a condition. It was writing
   * somebody it had never met. Condition and bearing are safe to hand over:
   * they are what an onlooker could see.
   */
  pc: { name: string; selfPronoun: string; bearing: string[]; condition: string[] };
  /** Verbatim, because pronoun continuity lives in the surface text. */
  recentTurns: string[];
  /**
   * The person the player is actually speaking with, if any. Register binds to
   * dialogue: narration is not spoken by anybody, and forcing an NPC's pronouns
   * onto scene description makes them narrate the world at the player.
   */
  speaking: string | null;
  /** Only what the player has already established. */
  canonFacts: string[];
  /**
   * Dispositions that shifted this turn, phrased for prose.
   *
   * A change the player can feel is the whole point of tracking it; a number
   * that moved silently is not a story.
   */
  shifts: string[];
  brief: WriterBrief;
  outcome: { tier: Tier; narrate: string } | null;
};

export type ViewOptions = {
  brief: WriterBrief;
  /** Person id who has dialogue this turn. */
  speaking?: string | null;
  outcome?: { tier: Tier; narrate: string } | null;
  recentTurns?: string[];
  canonFacts?: string[];
  shifts?: string[];
};

export function toWriterView(state: PlayState, opts: ViewOptions): WriterView {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);

  /**
   * The Director is handed place ids so it can propose a move, and it echoes
   * them into the brief it writes for the Writer — which then narrates "the
   * vast emptiness of warehouse_south". Generated worlds are cleaned at birth
   * by `humanisePlaces`; this catches what the Director adds each turn, and
   * covers worlds generated before that existed.
   */
  const names = displayNames(region?.places ?? [], state.world.people);
  const say = (text: string) => humanise(text, names);
  const nameOf = (id: string) =>
    (id === PLAYER ? state.sheet.name : state.world.people[id]?.name ?? id);

  const peoplePresent: PresentPerson[] = (place?.people ?? [])
    .map((id) => state.world.people[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.alive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      oneLine: p.oneLine,
      disposition: describePersonality(dispositionOf(p)),
      condition: describeMental(p.needs),
      register: registerForPerson(p, trustToward(state.world.edges, p.id)),
      believes: beliefsAbout(p.beliefs, PLAYER, nameOf),
    }));

  return {
    language: state.world.language,
    place: {
      name: say(place?.name ?? ''),
      description: say(place?.description ?? ''),
      affordances: (place?.affordances ?? []).map(say),
    },
    peoplePresent,
    pc: {
      name: state.sheet.name,
      selfPronoun: state.sheet.voice.selfPronoun,
      bearing: describePersonality(dispositionOf(state.sheet)),
      condition: describeMental(state.sheet.needs),
    },
    speaking: opts.speaking ?? null,
    recentTurns: opts.recentTurns ?? [],
    canonFacts: opts.canonFacts ?? [],
    shifts: opts.shifts ?? [],
    brief: {
      ...opts.brief,
      intent: say(opts.brief.intent),
      mustInclude: opts.brief.mustInclude.map(say),
      mustNotMention: opts.brief.mustNotMention.map(say),
    },
    outcome: opts.outcome ? { ...opts.outcome, narrate: say(opts.outcome.narrate) } : null,
  };
}

/**
 * Everything the player has not earned the right to see.
 *
 * Two different secrets, with two different rules — collapsing them was what
 * made every turn near a signposted neighbour fail.
 *
 * A place's DESCRIPTION is what you find when you get there, so it stays hidden
 * until you have been. A place's NAME is not a secret at all once the map draws
 * it: the local map labels every connected place and the game offers "go to
 * <name>" as a suggested action. The guard has to agree with what the interface
 * already shows, or the two contradict each other and the turn dies rather than
 * the spoiler.
 *
 * Everything on another floor stays hidden either way — the Writer has no
 * business knowing what is upstairs.
 */
export function hiddenStrings(world: World): string[] {
  const hidden: string[] = [];
  const current = world.currentRegion;

  const region = activeRegion(world);

  /**
   * Every place whose name the map has ever shown.
   *
   * Standing somewhere labels all of its connections, so anywhere you have
   * been has already published its neighbours' names. Deriving this from
   * `discovered` — which only ever grows — makes the set MONOTONIC, and that
   * matters: an adjacency-only rule un-reveals a name the moment you walk on,
   * so a brief written for the room you just left failed the check against the
   * room you just entered, and the turn died instead of the spoiler.
   */
  const signposted = new Set<string>();
  for (const p of region?.places ?? []) {
    if (!p.discovered && p.id !== world.currentPlace) continue;
    for (const c of p.connections) signposted.add(c);
  }

  for (const record of Object.values(world.regions)) {
    if (record.detail !== 'full') continue;
    for (const place of record.places) {
      const elsewhere = record.id !== current;
      // Standing somewhere discovers it, whatever the flag says. Without this
      // the place the player just left counts as a secret the moment they walk
      // out of it, and every move fails the leak check.
      const seen = !elsewhere && (place.id === world.currentPlace || place.discovered);
      const named = seen || (!elsewhere && signposted.has(place.id));

      if (!named && place.name.trim()) hidden.push(place.name);
      if (!seen && place.description.trim()) hidden.push(place.description);
    }
  }
  return [...new Set(hidden)];
}

export class WriterLeakError extends Error {}

/**
 * Throw if anything the player should not know reached the Writer payload.
 *
 * Deliberately fails loudly: a silent leak is a spoiler the player can never
 * un-read, so it is better to lose the turn than to ship the passage.
 */
export function assertNoLeak(view: WriterView, world: World): void {
  // Everything the Writer is told EXCEPT the transcript.
  //
  // `recentTurns` is prose the player has already read. Scanning it is a
  // category error — it cannot spoil anything — and it actively breaks the
  // game, because what counts as visible changes as the player walks. A place
  // named legitimately while standing next to it would become a "leak" one step
  // later, killing every turn that remembered it. The guard's job is to stop
  // NEW secrets reaching the Writer.
  const { recentTurns: _alreadyRead, ...unseen } = view;
  const payload = JSON.stringify(unseen);
  const allowed = new Set([view.place.name, view.place.description]);

  for (const secret of hiddenStrings(world)) {
    if (allowed.has(secret)) continue;
    if (payload.includes(secret)) {
      throw new WriterLeakError(`writer payload leaked hidden content: "${secret.slice(0, 60)}"`);
    }
  }
}
