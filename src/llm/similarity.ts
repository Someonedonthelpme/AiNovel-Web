import type { FactId } from '../world/types.ts';

/**
 * Semantic matching over established canon.
 *
 * A generated world creates two questions the engine has to answer on every
 * turn: "has the player already learned this?" and "which fact does this
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

export type FactMatch = { fact: FactId; score: number };

export type FactVectors = { fact: FactId; vector: readonly number[] }[];

/**
 * Rank facts by similarity to an utterance.
 *
 * `threshold` is deliberately a caller decision: matching for "did the player
 * just learn this" wants to be strict, while "what are they asking about" can
 * be loose.
 */
export function rankFacts(query: readonly number[], vectors: FactVectors, opts: { threshold?: number; limit?: number } = {}): FactMatch[] {
  const threshold = opts.threshold ?? 0;
  const limit = opts.limit ?? vectors.length;
  return vectors
    .map((v) => ({ fact: v.fact, score: cosine(query, v.vector) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score || a.fact.localeCompare(b.fact))
    .slice(0, limit);
}

/** The single best match, or null when nothing clears the bar. */
export function bestFact(query: readonly number[], vectors: FactVectors, threshold: number): FactMatch | null {
  return rankFacts(query, vectors, { threshold, limit: 1 })[0] ?? null;
}

/**
 * Facts the player does not already know, ranked by relevance — what the
 * Director should be considering revealing this turn.
 */
export function candidateReveals(
  query: readonly number[],
  vectors: FactVectors,
  known: ReadonlySet<FactId>,
  opts: { threshold?: number; limit?: number } = {},
): FactMatch[] {
  return rankFacts(query, vectors.filter((v) => !known.has(v.fact)), opts);
}
