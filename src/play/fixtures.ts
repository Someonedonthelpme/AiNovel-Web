import type { DirectorOutput, FlatDelta, Outcome } from '../llm/director.ts';
import { sheet } from '../session/fixtures.ts';
import { groundFloor, person, world } from '../world/fixtures.ts';
import type { World } from '../world/types.ts';
import { initialPlayState } from './state.ts';
import type { PlayState } from './state.ts';

export function playState(over: Partial<World> = {}): PlayState {
  const w = world({
    // Thai, because the register guard only engages for Thai.
    language: 'th',
    currentPlace: 'town',
    regions: { 'floor-0': { ...groundFloor(), exit: null } },
    people: {
      smith: person('smith', { name: 'Ora the smith', oneLine: 'sells iron, trusts no one', trust: 0 }),
      warden: person('warden', { name: 'Warden Bex', oneLine: 'keeps the gate', trust: -2, status: 'superior' }),
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
  timeSpent: 1,
  revealExit: '',
  startCombat: false, useItem: '', equipItem: '', rest: 'none',
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
