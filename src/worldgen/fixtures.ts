import type { Bible, Npc, Stats } from '../engine/types.ts';
import { deriveBeats, walkReachable } from '../engine/cluegraph.ts';

const stats = (o: Partial<Stats> = {}): Stats => ({
  observation: 1, nerve: 1, charm: 1, cunning: 1, composure: 1, ...o,
});

export function npc(id: string, over: Partial<Npc> = {}): Npc {
  return {
    id,
    name: id,
    role: 'witness',
    status: 'peer',
    personality: { traits: [], wants: '', fears: '', secret: '' },
    voice: {
      selfPronoun: 'ดิฉัน',
      addressBands: { '-3': 'คุณ', '0': 'คุณ', '2': 'เธอ' },
      particleBands: { '-3': 'ค่ะ', '2': 'นะ' },
      tics: [],
    },
    stats: stats(),
    knowledge: { knows: [], liesAbout: [] },
    relationships: { toPC: 0, toOthers: {} },
    agenda: [],
    agendaPace: 3,
    ...over,
  };
}

/** A case that is coherent and actually solvable. */
export function goodBible(): Bible {
  const clues: Bible['clues'] = [
    { id: 'c1', fact: 'A ledger is hidden under the clinic floorboards.', heldBy: { kind: 'scene', location: 'clinic' }, gate: { kind: 'open' } },
    { id: 'c2', fact: 'The victim was dead before the shot was fired.', heldBy: { kind: 'npc', id: 'doctor' }, gate: { kind: 'trust', npc: 'doctor', min: 1 } },
    { id: 'c3', fact: 'Mali was seen at the villa after midnight.', heldBy: { kind: 'npc', id: 'servant' }, gate: { kind: 'hasClue', clue: 'c1' } },
    { id: 'c4', fact: "Mali forged her brother's signature on the ledger.", heldBy: { kind: 'npc', id: 'doctor' }, gate: { kind: 'allOf', of: [{ kind: 'hasClue', clue: 'c2' }, { kind: 'hasClue', clue: 'c3' }] } },
  ];

  const cast = [
    npc('doctor', {
      role: 'clinic doctor',
      status: 'superior',
      knowledge: { knows: ['c2', 'c4'], liesAbout: ['c2'] },
      stats: stats({ composure: 3, cunning: 2 }),
      agenda: ['pack her bag', 'leave for the station'],
      agendaPace: 3,
    }),
    npc('servant', { role: 'house servant', knowledge: { knows: ['c3'], liesAbout: [] }, agenda: [] }),
    npc('mali', { role: 'the sister', knowledge: { knows: [], liesAbout: [] }, agenda: ['burn the ledger'], agendaPace: 4 }),
  ];

  const solutionRequires = ['c2', 'c3', 'c4'];
  const walk = walkReachable(clues, () => true, (id) => cast.some((n) => n.id === id));
  const beats = deriveBeats(solutionRequires, walk.depth, (c) => [`pressure-A for ${c}`, `pressure-B for ${c}`]);

  return {
    meta: { id: 'good-1', language: 'th', premise: 'A silk merchant dies during Songkran.', setting: 'Bangkok', era: '1963', tone: 'humid, claustrophobic' },
    truth: { culprit: 'mali', method: 'arsenic in the tea', motive: 'the stolen patterns', timeline: [] },
    pc: { name: 'Anan', background: 'ex-army, now private', traits: ['blunt'], stats: stats({ observation: 3, nerve: 2 }), voice: { selfPronoun: 'ผม', underStress: 'กู' } },
    cast,
    clues,
    solutionRequires,
    beats,
    startLocation: 'clinic',
  };
}

/**
 * The bible the local Qwen actually produced during testing, transcribed.
 *
 * It is schema-valid and semantically broken in four ways: one NPC where three
 * were demanded, `heldBy` naming NPCs absent from the cast, a solution that
 * depends on those phantom NPCs' clues, and a culprit who is not in the cast.
 * The validator must reject it.
 */
export function brokenGeneratedBible(): Bible {
  const clues: Bible['clues'] = [
    { id: 'clue1', fact: 'The garden shed door was ajar, one arsenic vial missing.', heldBy: { kind: 'npc', id: 'Panya' }, gate: { kind: 'open' } },
    { id: 'clue2', fact: "The victim's teacup showed white residue.", heldBy: { kind: 'npc', id: 'Niran' }, gate: { kind: 'open' } },
    { id: 'clue3', fact: 'A torn design sketch was in Niran’s coat pocket.', heldBy: { kind: 'npc', id: 'Panya' }, gate: { kind: 'open' } },
    { id: 'clue4', fact: 'A figure entered the villa after midnight with a small box.', heldBy: { kind: 'npc', id: 'Mali' }, gate: { kind: 'open' } },
    { id: 'clue5', fact: "Niran's hands bore fresh cuts from garden tools.", heldBy: { kind: 'npc', id: 'Panya' }, gate: { kind: 'open' } },
  ];

  return {
    meta: { id: 'broken-1', language: 'en', premise: 'A wealthy silk merchant is found dead during Songkran.', setting: 'Bangkok', era: '1960s', tone: 'festive' },
    truth: { culprit: 'Niran', method: 'poisoned tea', motive: 'revenge', timeline: [] },
    pc: { name: 'PC', background: '', traits: [], stats: stats(), voice: { selfPronoun: 'ผม', underStress: 'กู' } },
    cast: [npc('Panya', { knowledge: { knows: ['clue1', 'clue3', 'clue5'], liesAbout: [] } })],
    clues,
    solutionRequires: ['clue1', 'clue2', 'clue3', 'clue4', 'clue5'],
    beats: [{ id: 'b1', exitWhen: 'clue1', leash: 3, pressure: [] }],
    startLocation: 'villa',
  };
}
