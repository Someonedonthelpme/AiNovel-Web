import test from 'node:test';
import assert from 'node:assert/strict';
import { bestClue, candidateReveals, cosine, rankClues } from './similarity.ts';
import { extractJson } from './local.ts';

const v = (...xs: number[]) => xs;

test('cosine is 1 for identical direction and 0 for orthogonal', () => {
  assert.equal(cosine(v(1, 0), v(1, 0)), 1);
  assert.equal(cosine(v(1, 0), v(5, 0)), 1, 'magnitude must not matter');
  assert.equal(cosine(v(1, 0), v(0, 1)), 0);
  assert.equal(cosine(v(1, 0), v(-1, 0)), -1);
});

test('cosine treats a zero vector as unrelated rather than dividing by zero', () => {
  assert.equal(cosine(v(0, 0), v(1, 1)), 0);
});

test('cosine rejects mismatched dimensions instead of returning nonsense', () => {
  assert.throws(() => cosine(v(1, 2), v(1, 2, 3)), /length mismatch/);
});

const vectors = [
  { clue: 'c1', vector: v(1, 0, 0) },
  { clue: 'c2', vector: v(0, 1, 0) },
  { clue: 'c3', vector: v(0.9, 0.1, 0) },
];

test('ranking orders by similarity, best first', () => {
  const r = rankClues(v(1, 0, 0), vectors);
  assert.deepEqual(r.map((x) => x.clue), ['c1', 'c3', 'c2']);
});

test('the threshold excludes weak matches', () => {
  const r = rankClues(v(1, 0, 0), vectors, { threshold: 0.5 });
  assert.deepEqual(r.map((x) => x.clue), ['c1', 'c3']);
});

test('bestClue returns null when nothing clears the bar', () => {
  assert.equal(bestClue(v(0, 0, 1), vectors, 0.5), null);
  assert.equal(bestClue(v(1, 0, 0), vectors, 0.5)?.clue, 'c1');
});

test('ties break deterministically by id', () => {
  const tied = [
    { clue: 'z', vector: v(1, 0) },
    { clue: 'a', vector: v(1, 0) },
  ];
  assert.deepEqual(rankClues(v(1, 0), tied).map((x) => x.clue), ['a', 'z']);
});

test('candidate reveals exclude what the player already knows', () => {
  const r = candidateReveals(v(1, 0, 0), vectors, new Set(['c1']));
  assert.deepEqual(r.map((x) => x.clue), ['c3', 'c2']);
});

test('extractJson survives fenced output', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test('extractJson survives prose wrapped around the object', () => {
  assert.deepEqual(extractJson('Here you go:\n{"a":[1,2]}\nHope that helps.'), { a: [1, 2] });
});

test('extractJson throws rather than silently returning nothing', () => {
  assert.throws(() => extractJson('no json at all'), /no JSON object/);
});
