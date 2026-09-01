import type { Bible, ClueId, Gate, NpcId } from '../engine/types.ts';
import { flagsIn, walkReachable } from '../engine/cluegraph.ts';

/**
 * The validator that makes generated cases trustworthy.
 *
 * A procedurally generated mystery is routinely unsolvable — the clues that would
 * let you deduce the answer don't all exist, or can't be reached. That is not
 * fixable at play time, so it must be caught here, before the bible is frozen.
 *
 * Pure code, no model involved. Every check below corresponds to a failure mode
 * observed in real generator output.
 */

export type Issue = { code: string; message: string; refs?: string[] };

export type ValidationResult = {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  reachable: ClueId[];
  unreachable: ClueId[];
};

function gateRefs(gate: Gate): { clues: ClueId[]; npcs: NpcId[] } {
  switch (gate.kind) {
    case 'hasClue':
      return { clues: [gate.clue], npcs: [] };
    case 'trust':
      return { clues: [], npcs: [gate.npc] };
    case 'allOf':
    case 'anyOf': {
      const parts = gate.of.map(gateRefs);
      return {
        clues: parts.flatMap((p) => p.clues),
        npcs: parts.flatMap((p) => p.npcs),
      };
    }
    default:
      return { clues: [], npcs: [] };
  }
}

export function validateBible(bible: Bible): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const npcIds = new Set(bible.cast.map((n) => n.id));
  const clueIds = new Set(bible.clues.map((c) => c.id));
  const npcExists = (id: NpcId) => npcIds.has(id);

  // --- duplicates -----------------------------------------------------------
  const dupe = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
  const dupNpcs = dupe(bible.cast.map((n) => n.id));
  const dupClues = dupe(bible.clues.map((c) => c.id));
  if (dupNpcs.length) errors.push({ code: 'DUPLICATE_NPC_ID', message: 'Duplicate NPC ids.', refs: dupNpcs });
  if (dupClues.length) errors.push({ code: 'DUPLICATE_CLUE_ID', message: 'Duplicate clue ids.', refs: dupClues });

  // --- cast sanity ----------------------------------------------------------
  if (bible.cast.length < 2) {
    errors.push({ code: 'CAST_TOO_SMALL', message: `A mystery needs suspects; cast has ${bible.cast.length}.` });
  }
  if (!npcExists(bible.truth.culprit)) {
    errors.push({ code: 'CULPRIT_NOT_IN_CAST', message: `Culprit "${bible.truth.culprit}" is not in the cast.`, refs: [bible.truth.culprit] });
  }

  // --- referential integrity: clues -> holders -------------------------------
  // Observed generator failure: heldBy naming NPCs absent from the cast.
  for (const clue of bible.clues) {
    if (clue.heldBy.kind === 'npc' && !npcExists(clue.heldBy.id)) {
      errors.push({
        code: 'DANGLING_HOLDER',
        message: `Clue "${clue.id}" is held by "${clue.heldBy.id}", who is not in the cast.`,
        refs: [clue.id, clue.heldBy.id],
      });
    }
    const refs = gateRefs(clue.gate);
    for (const c of refs.clues) {
      if (!clueIds.has(c)) {
        errors.push({ code: 'DANGLING_GATE_CLUE', message: `Clue "${clue.id}" is gated on unknown clue "${c}".`, refs: [clue.id, c] });
      }
    }
    for (const n of refs.npcs) {
      if (!npcExists(n)) {
        errors.push({ code: 'DANGLING_GATE_NPC', message: `Clue "${clue.id}" is gated on unknown NPC "${n}".`, refs: [clue.id, n] });
      }
    }
    const flags = flagsIn(clue.gate);
    if (flags.length) {
      warnings.push({
        code: 'FLAG_GATE_UNPROVEN',
        message: `Clue "${clue.id}" is gated on runtime flag(s); reachability cannot be proven statically.`,
        refs: [clue.id, ...flags],
      });
    }
  }

  // --- referential integrity: NPC knowledge ---------------------------------
  for (const npc of bible.cast) {
    for (const c of npc.knowledge.knows) {
      if (!clueIds.has(c)) {
        errors.push({ code: 'DANGLING_KNOWS', message: `NPC "${npc.id}" knows unknown clue "${c}".`, refs: [npc.id, c] });
      }
    }
    for (const c of npc.knowledge.liesAbout) {
      if (!npc.knowledge.knows.includes(c)) {
        errors.push({
          code: 'LIES_ABOUT_UNKNOWN',
          message: `NPC "${npc.id}" lies about "${c}" but does not know it.`,
          refs: [npc.id, c],
        });
      }
    }
    for (const other of Object.keys(npc.relationships.toOthers)) {
      if (!npcExists(other)) {
        warnings.push({ code: 'DANGLING_RELATIONSHIP', message: `NPC "${npc.id}" has a relationship to unknown "${other}".`, refs: [npc.id, other] });
      }
    }
  }

  // A clue held by an NPC must actually be in their knows list, or the Director
  // will look it up and find nothing.
  for (const clue of bible.clues) {
    if (clue.heldBy.kind !== 'npc') continue;
    const npc = bible.cast.find((n) => n.id === (clue.heldBy as { id: NpcId }).id);
    if (npc && !npc.knowledge.knows.includes(clue.id)) {
      errors.push({
        code: 'HOLDER_DOES_NOT_KNOW',
        message: `Clue "${clue.id}" is held by "${npc.id}" but is missing from their knows list.`,
        refs: [clue.id, npc.id],
      });
    }
  }

  // --- the culprit must not hand over their own conviction -------------------
  // Observed generator failure: the murderer holds the incriminating evidence
  // with an empty liesAbout, so the case solves itself on first contact.
  for (const clueId of bible.solutionRequires) {
    const clue = bible.clues.find((c) => c.id === clueId);
    if (!clue || clue.heldBy.kind !== 'npc') continue;
    if (clue.heldBy.id !== bible.truth.culprit) continue;
    const culprit = bible.cast.find((n) => n.id === bible.truth.culprit);
    if (culprit && !culprit.knowledge.liesAbout.includes(clueId)) {
      errors.push({
        code: 'CULPRIT_SELF_INCRIMINATES',
        message: `Solution clue "${clueId}" is held by the culprit and not lied about — they would simply hand it over.`,
        refs: [clueId, bible.truth.culprit],
      });
    }
  }

  // --- solvability ----------------------------------------------------------
  if (bible.solutionRequires.length === 0) {
    errors.push({ code: 'NO_SOLUTION', message: 'solutionRequires is empty; the case has no win condition.' });
  }
  for (const c of bible.solutionRequires) {
    if (!clueIds.has(c)) {
      errors.push({ code: 'DANGLING_SOLUTION_CLUE', message: `solutionRequires names unknown clue "${c}".`, refs: [c] });
    }
  }

  const holderValid = (c: (typeof bible.clues)[number]) =>
    c.heldBy.kind !== 'npc' ? true : npcExists(c.heldBy.id);

  const walk = walkReachable(bible.clues, holderValid, npcExists);

  const missing = bible.solutionRequires.filter((c) => !walk.reachable.has(c));
  if (missing.length) {
    errors.push({
      code: 'UNSOLVABLE',
      message: `The case cannot be solved: ${missing.length} required clue(s) are unreachable.`,
      refs: missing,
    });
  }

  if (walk.unreachable.length && !missing.length) {
    warnings.push({
      code: 'ORPHAN_CLUES',
      message: `${walk.unreachable.length} clue(s) are unreachable but not required for the solution.`,
      refs: walk.unreachable,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    reachable: [...walk.reachable],
    unreachable: walk.unreachable,
  };
}
