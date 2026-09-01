import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBeats, flagsIn, isOpen, isSatisfiable, walkReachable } from './cluegraph.ts';
import type { Clue, Gate } from './types.ts';
import { goodBible } from '../worldgen/fixtures.ts';

const ctx = (facts: string[], trust: Record<string, number> = {}, flags: Record<string, boolean> = {}) => ({
  playerFacts: new Set(facts),
  trustOf: (n: string) => trust[n] ?? 0,
  flags,
});

test('isOpen evaluates every gate kind', () => {
  assert.equal(isOpen({ kind: 'open' }, ctx([])), true);
  assert.equal(isOpen({ kind: 'trust', npc: 'd', min: 2 }, ctx([], { d: 1 })), false);
  assert.equal(isOpen({ kind: 'trust', npc: 'd', min: 2 }, ctx([], { d: 2 })), true);
  assert.equal(isOpen({ kind: 'hasClue', clue: 'c1' }, ctx(['c1'])), true);
  assert.equal(isOpen({ kind: 'flag', flag: 'f' }, ctx([], {}, { f: true })), true);
  assert.equal(isOpen({ kind: 'flag', flag: 'f' }, ctx([])), false);
});

test('allOf and anyOf compose', () => {
  const g: Gate = { kind: 'allOf', of: [{ kind: 'hasClue', clue: 'a' }, { kind: 'anyOf', of: [{ kind: 'hasClue', clue: 'b' }, { kind: 'hasClue', clue: 'c' }] }] };
  assert.equal(isOpen(g, ctx(['a'])), false);
  assert.equal(isOpen(g, ctx(['a', 'c'])), true);
});

test('satisfiability differs from openness — a trust gate is closed now but reachable later', () => {
  const g: Gate = { kind: 'trust', npc: 'doctor', min: 3 };
  assert.equal(isOpen(g, ctx([], { doctor: 0 })), false);
  assert.equal(isSatisfiable(g, new Set(), (id) => id === 'doctor'), true);
});

test('a trust gate above the maximum band can never be satisfied', () => {
  assert.equal(isSatisfiable({ kind: 'trust', npc: 'doctor', min: 99 }, new Set(), () => true), false);
});

test('a trust gate on a nonexistent NPC can never be satisfied', () => {
  assert.equal(isSatisfiable({ kind: 'trust', npc: 'ghost', min: 1 }, new Set(), () => false), false);
});

test('flagsIn finds nested flag dependencies', () => {
  const g: Gate = { kind: 'allOf', of: [{ kind: 'flag', flag: 'a' }, { kind: 'anyOf', of: [{ kind: 'flag', flag: 'b' }, { kind: 'open' }] }] };
  assert.deepEqual(flagsIn(g).sort(), ['a', 'b']);
});

test('the reachability walk assigns depth by dependency layer', () => {
  const b = goodBible();
  const w = walkReachable(b.clues, () => true, () => true);
  assert.equal(w.depth.get('c1'), 0);
  assert.equal(w.depth.get('c2'), 0);
  assert.equal(w.depth.get('c3'), 1);
  assert.equal(w.depth.get('c4'), 2);
  assert.deepEqual(w.unreachable, []);
});

test('an invalid holder makes a clue unreachable', () => {
  const clues: Clue[] = [{ id: 'x', fact: '', heldBy: { kind: 'npc', id: 'ghost' }, gate: { kind: 'open' } }];
  const w = walkReachable(clues, (c) => c.heldBy.kind !== 'npc', () => false);
  assert.deepEqual(w.unreachable, ['x']);
});

test('derived beats follow graph depth, so they can never deadlock', () => {
  const b = goodBible();
  const w = walkReachable(b.clues, () => true, () => true);
  const beats = deriveBeats(['c4', 'c2', 'c3'], w.depth, () => ['p']);
  assert.deepEqual(beats.map((x) => x.exitWhen), ['c2', 'c3', 'c4']);
  assert.deepEqual(beats.map((x) => x.id), ['b1', 'b2', 'b3']);
});

test('beat derivation is stable when depths tie', () => {
  const depth = new Map([['z', 0], ['a', 0]]);
  const beats = deriveBeats(['z', 'a'], depth, () => []);
  assert.deepEqual(beats.map((b) => b.exitWhen), ['a', 'z']);
});
