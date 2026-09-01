/**
 * The provider boundary.
 *
 * Everything that needs a model goes through this interface, so the same code
 * runs against LM Studio (free, for development) or a hosted model (for real
 * play) without changing a line. It also means the whole generation layer is
 * testable offline with `FakeProvider`.
 *
 * Provider implementations live in their own modules and never import each
 * other: `localProvider.ts` knows only LM Studio, and a Claude provider will
 * know only the Anthropic SDK.
 */

export type PromptMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type TextRequest = {
  messages: PromptMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type StructuredRequest = {
  messages: PromptMessage[];
  /** Names the schema for the provider; some use it in the grammar. */
  schemaName: string;
  /** A JSON Schema object. */
  schema: unknown;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export interface Provider {
  readonly name: string;
  /** Free-form prose, e.g. an interview question. */
  text(req: TextRequest): Promise<string>;
  /** Schema-constrained JSON. Throws if the provider cannot produce valid JSON. */
  structured<T>(req: StructuredRequest): Promise<T>;
}

/** A recorded call, for assertions in tests. */
export type RecordedCall =
  | { kind: 'text'; req: TextRequest }
  | { kind: 'structured'; req: StructuredRequest };

export type FakeScript = {
  /** Consumed in order; the last entry repeats once exhausted. */
  text?: string[];
  structured?: unknown[];
};

/**
 * A provider that returns scripted answers and records what it was asked.
 *
 * This is what makes the generation layer testable without a network, a key, or
 * a cent of spend.
 */
export class FakeProvider implements Provider {
  readonly name = 'fake';
  readonly calls: RecordedCall[] = [];
  private textAt = 0;
  private structuredAt = 0;
  private readonly script: FakeScript;

  constructor(script: FakeScript = {}) {
    this.script = script;
  }

  async text(req: TextRequest): Promise<string> {
    this.calls.push({ kind: 'text', req });
    const list = this.script.text ?? [];
    if (list.length === 0) return '';
    const value = list[Math.min(this.textAt, list.length - 1)];
    this.textAt++;
    return value;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    this.calls.push({ kind: 'structured', req });
    const list = this.script.structured ?? [];
    if (list.length === 0) throw new Error('FakeProvider has no structured responses scripted');
    const value = list[Math.min(this.structuredAt, list.length - 1)];
    this.structuredAt++;
    return value as T;
  }

  /** The most recent request of a kind, for asserting on prompt contents. */
  lastRequest(kind: 'text'): TextRequest | null;
  lastRequest(kind: 'structured'): StructuredRequest | null;
  lastRequest(kind: 'text' | 'structured'): TextRequest | StructuredRequest | null {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      if (this.calls[i].kind === kind) return this.calls[i].req;
    }
    return null;
  }

  /** Every message body sent to the provider, flattened — used by redaction tests. */
  allSentText(): string {
    return this.calls.flatMap((c) => c.req.messages.map((m) => m.content)).join('\n');
  }
}
