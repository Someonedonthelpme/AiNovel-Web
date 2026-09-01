import type { ClueId } from '../engine/types.ts';

/**
 * Semantic matching over the clue graph.
 *
 * A generated world creates two questions the engine has to answer on every
 * turn: "has the player already learned this?" and "which clue does this
 * utterance refer to?". Both are similarity lookups, and doing them locally
 * makes them free, instant and deterministic instead of another model call.
 *
 * The vector maths lives here and takes embeddings as arguments, so it is fully
 * testable without touching the endpoint.
 */

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type ClueMatch = { clue: ClueId; score: number };

export type ClueVectors = { clue: ClueId; vector: readonly number[] }[];

/**
 * Rank clues by similarity to an utterance.
 *
 * `threshold` is deliberately a caller decision: matching for "did the player
 * just learn this" wants to be strict, while "what are they asking about" can
 * be loose.
 */
export function rankClues(query: readonly number[], vectors: ClueVectors, opts: { threshold?: number; limit?: number } = {}): ClueMatch[] {
  const threshold = opts.threshold ?? 0;
  const limit = opts.limit ?? vectors.length;
  return vectors
    .map((v) => ({ clue: v.clue, score: cosine(query, v.vector) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score || a.clue.localeCompare(b.clue))
    .slice(0, limit);
}

/** The single best match, or null when nothing clears the bar. */
export function bestClue(query: readonly number[], vectors: ClueVectors, threshold: number): ClueMatch | null {
  return rankClues(query, vectors, { threshold, limit: 1 })[0] ?? null;
}

/**
 * Clues the player does not already know, ranked by relevance — what the
 * Director should be considering revealing this turn.
 */
export function candidateReveals(
  query: readonly number[],
  vectors: ClueVectors,
  known: ReadonlySet<ClueId>,
  opts: { threshold?: number; limit?: number } = {},
): ClueMatch[] {
  return rankClues(query, vectors.filter((v) => !known.has(v.clue)), opts);
}
