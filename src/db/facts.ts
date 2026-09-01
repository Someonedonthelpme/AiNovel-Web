import { and, cosineDistance, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { config } from '../config.ts';
import { embed } from '../llm/local.ts';
import type { PlayState } from '../play/state.ts';
import type { Fact } from '../world/types.ts';
import { getDb } from './db.ts';
import { EMBEDDING_DIMENSION, facts } from './schema.ts';

/**
 * Canon storage with a real vector index.
 *
 * The canon guard previously embedded facts into an in-process Map, so every
 * session started cold and a long one held the whole world in memory. pgvector
 * stores each embedding once, forever, and retrieves the relevant few through an
 * HNSW index.
 *
 * Distance is cosine, matching how similarity is scored everywhere else.
 */

export { EMBEDDING_DIMENSION };

export async function saveFacts(sessionId: string, incoming: Fact[], model?: string): Promise<number> {
  if (incoming.length === 0) return 0;
  const db = getDb();

  const existing = await db
    .select({ factId: facts.factId })
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), inArray(facts.factId, incoming.map((f) => f.id))));

  const known = new Set(existing.map((r) => r.factId));
  const fresh = incoming.filter((f) => !known.has(f.id));
  if (fresh.length === 0) return 0;

  // A fact never changes once established, so it is embedded exactly once.
  let vectors: number[][] = [];
  try {
    vectors = await embed(fresh.map((f) => f.text), { model: model ?? config.embedModel });
  } catch {
    // Losing the embedder should cost retrieval quality, never the fact itself.
    vectors = [];
  }

  const rows = fresh.map((fact, i) => {
    const vector = vectors[i];
    if (vector && vector.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `embedding width ${vector.length} does not match the schema's ${EMBEDDING_DIMENSION}; ` +
          'storing it would fill the table with vectors that mean nothing',
      );
    }
    return {
      sessionId,
      factId: fact.id,
      text: fact.text,
      region: fact.region,
      establishedTurn: fact.establishedAtTurn,
      embedding: vector ?? null,
    };
  });

  await db.insert(facts).values(rows).onConflictDoNothing();
  return rows.length;
}

/** Facts closest in meaning to the query; falls back to the newest. */
export async function relevantFacts(
  sessionId: string,
  query: string,
  topK = 5,
  model?: string,
): Promise<string[]> {
  const db = getDb();

  let queryVector: number[] | null = null;
  try {
    const [vector] = await embed([query], { model: model ?? config.embedModel });
    queryVector = vector ?? null;
  } catch {
    queryVector = null;
  }

  if (!queryVector) {
    const recent = await db
      .select({ text: facts.text })
      .from(facts)
      .where(eq(facts.sessionId, sessionId))
      .orderBy(desc(facts.establishedTurn))
      .limit(topK);
    return recent.map((r) => r.text);
  }

  const nearest = await db
    .select({ text: facts.text })
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), isNotNull(facts.embedding)))
    .orderBy(cosineDistance(facts.embedding, queryVector))
    .limit(topK);

  return nearest.map((r) => r.text);
}

/**
 * The canon guard, backed by the database.
 *
 * Drop-in replacement for the in-memory retriever: same signature, but the
 * embeddings outlive the process.
 */
export function pgFactRetriever(sessionId: string, topK = 5, model?: string) {
  return async (state: PlayState, input: string): Promise<string[]> => {
    // Persist anything established since the last turn, then retrieve.
    await saveFacts(sessionId, state.world.facts, model).catch(() => 0);
    try {
      return await relevantFacts(sessionId, input, topK, model);
    } catch {
      return state.world.facts.slice(-topK).map((f) => f.text);
    }
  };
}
