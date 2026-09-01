import type { PlayState } from '../play/state.ts';
import type { Fact } from '../world/types.ts';
import { embed } from './local.ts';
import { rankFacts } from './similarity.ts';

/**
 * The canon guard.
 *
 * AI worlds feel fake mostly because they contradict themselves. That is a
 * RETRIEVAL problem, not a memory problem: before writing, fetch the handful of
 * established truths relevant to this moment and state them as things the prose
 * may not contradict.
 *
 * Runs on the local embedder, so it costs nothing and adds no hosted call. Fact
 * vectors are cached by id — a fact never changes once established, so it is
 * embedded exactly once no matter how long the session runs.
 */

export type FactRetriever = (state: PlayState, input: string) => Promise<string[]>;

/** Small enough that the prompt stays flat however large the world grows. */
export const DEFAULT_TOP_K = 5;

export function localFactRetriever(topK = DEFAULT_TOP_K, model?: string): FactRetriever {
  const cache = new Map<string, number[]>();

  return async (state: PlayState, input: string): Promise<string[]> => {
    const facts: Fact[] = state.world.facts;
    if (facts.length === 0) return [];
    // Below the cutoff, ranking cannot help — just send everything.
    if (facts.length <= topK) return facts.map((f) => f.text);

    const missing = facts.filter((f) => !cache.has(f.id));

    try {
      if (missing.length) {
        const vectors = await embed(missing.map((f) => f.text), { model });
        missing.forEach((f, i) => cache.set(f.id, vectors[i]));
      }
      const [query] = await embed([input], { model });

      const ranked = rankFacts(
        query,
        facts
          .filter((f) => cache.has(f.id))
          .map((f) => ({ fact: f.id, vector: cache.get(f.id) as number[] })),
        { limit: topK },
      );
      const byId = new Map(facts.map((f) => [f.id, f.text]));
      return ranked.map((r) => byId.get(r.fact) ?? '').filter(Boolean);
    } catch {
      // A retrieval outage should degrade the prose, never stop the game.
      return facts.slice(-topK).map((f) => f.text);
    }
  };
}
