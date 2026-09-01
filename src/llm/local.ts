/**
 * Local LM Studio client — embeddings, cheap classification, and the free
 * development harness.
 *
 * Deliberately plain `fetch` rather than an SDK: the surface used here is three
 * endpoints, and keeping this module dependency-free makes the provider boundary
 * obvious. Nothing in here may import the Anthropic SDK, and vice versa.
 *
 * Neither local chat model is good enough to be the Writer (both drop Thai
 * register instructions) or the Director (structured output is unreliable). What
 * they are good for lives here.
 */

export const LOCAL_BASE_URL = process.env.LOCAL_LLM_URL ?? 'http://192.168.0.108:1234/v1';

export const LOCAL_MODELS = {
  /** Fast and small. English classification and the dev harness only. */
  small: 'llama-3.2-3b-instruct-abliterated',
  /** Coherent Thai, ~37 tok/s. Structure generation and Thai classification. */
  large: 'huihui-qwen3.6-35b-a3b-claude-4.7-opus-abliterated-mtp',
  /** English-only: Thai collapses to a single vector. See probeEmbeddingSeparation. */
  embedNomic: 'text-embedding-nomic-embed-text-v1.5',
  /** Multilingual, no input prefixes required. */
  embedBgeM3: 'text-embedding-bge-m3',
  /** Multilingual, newer. */
  embedQwen3: 'text-embedding-qwen3-embedding-0.6b',
} as const;

/** The embedder the app uses. Swap after verifying with scripts/compare-embedders.ts. */
export const DEFAULT_EMBED_MODEL: string = process.env.LOCAL_EMBED_MODEL ?? LOCAL_MODELS.embedBgeM3;

export type EmbedOptions = { model?: string; signal?: AbortSignal };

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LocalChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** A JSON Schema; LM Studio applies it as a decoding grammar. */
  jsonSchema?: { name: string; schema: unknown };
  signal?: AbortSignal;
};

export type LocalChatResult = {
  text: string;
  /** True when the text had to be recovered from the reasoning field. */
  fromReasoning: boolean;
  tokens: number;
  ms: number;
};

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${LOCAL_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`local llm ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

/**
 * Two traps this wrapper exists to absorb, both hit in real testing:
 *
 *  1. The Qwen returns its answer in `reasoning_content` while `content` is
 *     empty. Reading only `content` makes it look like the model returned
 *     nothing at all.
 *  2. `enable_thinking: false` and a `/no_think` prefix are both ignored, so
 *     thinking tokens still consume `max_tokens`. The default here is generous
 *     because a tight budget truncates the answer before it starts.
 */
export async function localChat(messages: ChatMessage[], opts: LocalChatOptions = {}): Promise<LocalChatResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model ?? LOCAL_MODELS.large,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (opts.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
    };
  }

  const json = await post('/chat/completions', body, opts.signal);
  const message = json?.choices?.[0]?.message ?? {};
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';

  return {
    text: content || reasoning,
    fromReasoning: content.length === 0 && reasoning.length > 0,
    tokens: json?.usage?.completion_tokens ?? 0,
    ms: Date.now() - started,
  };
}

/** Parse JSON from a local model, tolerating fenced or prose-wrapped output. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost balanced braces.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found in local model output');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export async function embed(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const json = await post('/embeddings', { model: opts.model ?? DEFAULT_EMBED_MODEL, input: texts }, opts.signal);
  const rows: { index: number; embedding: number[] }[] = json?.data ?? [];
  return [...rows].sort((a, b) => a.index - b.index).map((r) => r.embedding);
}

/**
 * Does the embedding model actually distinguish text in this language?
 *
 * This exists because of a real failure: `nomic-embed-text-v1.5` returns one
 * IDENTICAL vector for any Thai input (pairwise cosine 1.000000), while
 * separating English normally. A collapsed embedding space degrades silently —
 * every lookup just returns whatever clue happens to sort first — so any code
 * that gates on embeddings must probe first rather than assume.
 *
 * Returns the spread between the most and least similar pair. Anything below
 * ~0.02 means the space has collapsed and embeddings are unusable.
 */
export async function probeEmbeddingSeparation(samples: string[], opts: EmbedOptions = {}): Promise<number> {
  if (samples.length < 2) throw new Error('need at least two samples to probe separation');
  const vecs = await embed(samples, opts);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      const c = cosineOf(vecs[i], vecs[j]);
      min = Math.min(min, c);
      max = Math.max(max, c);
    }
  }
  return max - min;
}

/** Local copy so this module stays dependency-free in both directions. */
function cosineOf(a: number[], b: number[]): number {
  let d = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return x === 0 || y === 0 ? 0 : d / Math.sqrt(x * y);
}

export const EMBEDDING_COLLAPSE_THRESHOLD = 0.02;

export async function isLocalUp(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_BASE_URL}/models`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}
