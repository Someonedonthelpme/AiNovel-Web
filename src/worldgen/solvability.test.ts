import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBible } from './solvability.ts';
import { brokenGeneratedBible, goodBible, npc } from './fixtures.ts';
import type { Bible } from '../engine/types.ts';

const codes = (b: Bible) => validateBible(b).errors.map((e) => e.code);

test('a coherent solvable case is accepted', () => {
  const r = validateBible(goodBible());
  assert.deepEqual(r.errors, [], `unexpected errors: ${JSON.stringify(r.errors, null, 2)}`);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.reachable].sort(), ['c1', 'c2', 'c3', 'c4']);
});

test('the real broken generator output is rejected', () => {
  const r = validateBible(brokenGeneratedBible());
  assert.equal(r.ok, false);
  const found = r.errors.map((e) => e.code);
  // Every defect the local model actually produced must be named.
  assert.ok(found.includes('CAST_TOO_SMALL'), 'should catch the 1-NPC cast');
  assert.ok(found.includes('CULPRIT_NOT_IN_CAST'), 'should catch the phantom culprit');
  assert.ok(found.includes('DANGLING_HOLDER'), 'should catch heldBy naming absent NPCs');
  assert.ok(found.includes('UNSOLVABLE'), 'should catch that the case cannot be solved');

  const unsolvable = r.errors.find((e) => e.code === 'UNSOLVABLE');
  assert.deepEqual(unsolvable?.refs?.sort(), ['clue2', 'clue4']);
});

test('a solution clue behind an unreachable gate is caught', () => {
  const b = goodBible();
  // c4 now needs a clue that nothing can ever produce.
  b.clues = b.clues.map((c) => (c.id === 'c4' ? { ...c, gate: { kind: 'hasClue', clue: 'c_ghost' } } : c));
  const found = codes(b);
  assert.ok(found.includes('DANGLING_GATE_CLUE'));
  assert.ok(found.includes('UNSOLVABLE'));
});

test('a dependency cycle is unreachable, not an infinite loop', () => {
  const b = goodBible();
  b.clues = b.clues.map((c) => {
    if (c.id === 'c2') return { ...c, gate: { kind: 'hasClue', clue: 'c4' } };
    return c;
  });
  const r = validateBible(b);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'UNSOLVABLE'));
  assert.deepEqual(r.unreachable.sort(), ['c2', 'c4']);
});

test('the culprit may not hand over their own conviction', () => {
  const b = goodBible();
  // Move a solution clue to the culprit, with no intent to lie about it.
  b.clues = b.clues.map((c) => (c.id === 'c4' ? { ...c, heldBy: { kind: 'npc', id: 'mali' } } : c));
  b.cast = b.cast.map((n) => (n.id === 'mali' ? { ...n, knowledge: { knows: ['c4'], liesAbout: [] } } : n));
  assert.ok(codes(b).includes('CULPRIT_SELF_INCRIMINATES'));

  // Lying about it makes it legitimate again.
  b.cast = b.cast.map((n) => (n.id === 'mali' ? { ...n, knowledge: { knows: ['c4'], liesAbout: ['c4'] } } : n));
  assert.ok(!codes(b).includes('CULPRIT_SELF_INCRIMINATES'));
});

test('a holder who does not know their own clue is caught', () => {
  const b = goodBible();
  b.cast = b.cast.map((n) => (n.id === 'servant' ? { ...n, knowledge: { knows: [], liesAbout: [] } } : n));
  assert.ok(codes(b).includes('HOLDER_DOES_NOT_KNOW'));
});

test('lying about something you do not know is caught', () => {
  const b = goodBible();
  b.cast = b.cast.map((n) => (n.id === 'servant' ? { ...n, knowledge: { knows: ['c3'], liesAbout: ['c1'] } } : n));
  assert.ok(codes(b).includes('LIES_ABOUT_UNKNOWN'));
});

test('duplicate ids are caught', () => {
  const b = goodBible();
  b.cast = [...b.cast, npc('doctor')];
  b.clues = [...b.clues, b.clues[0]];
  const found = codes(b);
  assert.ok(found.includes('DUPLICATE_NPC_ID'));
  assert.ok(found.includes('DUPLICATE_CLUE_ID'));
});

test('an empty win condition is caught', () => {
  const b = goodBible();
  b.solutionRequires = [];
  assert.ok(codes(b).includes('NO_SOLUTION'));
});

test('flag gates are flagged as an unproven hole, not silently trusted', () => {
  const b = goodBible();
  b.clues = b.clues.map((c) => (c.id === 'c3' ? { ...c, gate: { kind: 'flag', flag: 'confronted_doctor' } } : c));
  const r = validateBible(b);
  assert.equal(r.ok, true, 'flag gates should not fail the case outright');
  const w = r.warnings.find((x) => x.code === 'FLAG_GATE_UNPROVEN');
  assert.ok(w, 'flag-gated reachability must be reported as unproven');
  assert.ok(w?.refs?.includes('confronted_doctor'));
});

test('orphan clues warn but do not fail the case', () => {
  const b = goodBible();
  b.clues = [...b.clues, { id: 'c9', fact: 'unrelated', heldBy: { kind: 'scene', location: 'x' }, gate: { kind: 'hasClue', clue: 'c9' } }];
  const r = validateBible(b);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'ORPHAN_CLUES'));
});
