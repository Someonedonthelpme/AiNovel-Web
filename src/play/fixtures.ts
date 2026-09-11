import type { DirectorOutput, FlatDelta, Outcome } from '../llm/director.ts';
import { sheet } from '../session/fixtures.ts';
import { groundFloor, person, world } from '../world/fixtures.ts';
import type { World } from '../world/types.ts';
import { traitsFor } from './traitbook.ts';
import { candidateSignetsFor } from './signetbook.ts';
import { initialPlayState } from './state.ts';
import type { PlayState } from './state.ts';

export function playState(over: Partial<World> = {}): PlayState {
  const w = world({
    // Thai, because the register guard only engages for Thai.
    language: 'th',
    currentPlace: 'town',
    regions: { 'floor-0': { ...groundFloor(), exit: null } },
    people: {
      smith: person('smith', { name: 'Ora the smith', oneLine: 'sells iron, trusts no one' }),
      warden: person('warden', { name: 'Warden Bex', oneLine: 'keeps the gate', status: 'superior' }),
    },
    ...over,
  });
  return initialPlayState(w, sheet({ language: 'th', voice: { selfPronoun: 'ผม', underStress: 'กู', addressBands: {}, particleBands: {}, tics: [] } }));
}

export const emptyDelta = (): FlatDelta => ({
  moveTo: '',
  learnFacts: [],
  trustPerson: '',
  trustChange: 0,
  deed: 'none',
  deedPerson: '',
  timeSpent: 1,
  revealExit: '',
  startCombat: false, useItem: '', equipItem: '', rest: 'none',
  amendLaw: 'none', amendBinds: 'none',
});

export const outcome = (narrate: string, over: Partial<FlatDelta> = {}): Outcome => ({
  narrate,
  delta: { ...emptyDelta(), ...over },
});

export function directorOutput(over: Partial<DirectorOutput> = {}): DirectorOutput {
  return {
    classification: 'NEUTRAL',
    addressedPerson: '',
    check: {
      required: false,
      ability: 'cha',
      vsPerson: '',
      onHit: outcome(''),
      onPartial: outcome(''),
      onMiss: outcome(''),
    },
    delta: emptyDelta(),
    brief: { intent: 'something happens', mustInclude: [], mustNotMention: [], tone: 'flat', length: 'short' },
    ...over,
  };
}

/** A Director output that calls for a check and commits to all three tiers. */
export function checkedOutput(): DirectorOutput {
  return directorOutput({
    classification: 'ADVANCES',
    addressedPerson: 'smith',
    check: {
      required: true,
      ability: 'cha',
      vsPerson: 'smith',
      onHit: outcome('She tells you plainly.', { trustPerson: 'smith', trustChange: 2, learnFacts: ['the forge runs at night'] }),
      onPartial: outcome('She tells you, but names her price.', { trustPerson: 'smith', trustChange: 1 }),
      onMiss: outcome('She turns her back.', { trustPerson: 'smith', trustChange: -1 }),
    },
  });
}

/**
 * What a given world actually grows branches from.
 *
 * Traits and Signets are generated per world now, so a test naming `butcher`
 * or `signet_quiet_kill` matches nothing and quietly asserts against a tree
 * that grew no branches at all — which is exactly how the first run of this
 * change passed four tests it should have failed.
 *
 * The origin here MUST match what `skillTreeFor` builds internally, or the
 * test would name traits the tree does not know about. Both use the class, the
 * subclass, the background name and the language.
 */
export function grownBy(
  seed: number,
  options: { classId?: string; subclassId?: string; background?: string; language?: 'th' | 'en' } = {},
  want = 4,
): { traits: string[]; signets: string[] } {
  const origin = { language: 'en' as const, background: '', ...options };
  const catalogue = traitsFor(seed, origin);

  return {
    traits: catalogue.filter((t) => t.opens).slice(0, want).map((t) => t.id),
    signets: candidateSignetsFor(seed, catalogue).filter((s) => s.opens).slice(0, want).map((s) => s.id),
  };
}

/** Traits this world offers that grow NOTHING — the quiet majority. */
export const quietTraitsOf = (seed: number, options: Parameters<typeof grownBy>[1] = {}): string[] =>
  traitsFor(seed, { language: 'en', background: '', ...options })
    .filter((t) => !t.opens).map((t) => t.id);
