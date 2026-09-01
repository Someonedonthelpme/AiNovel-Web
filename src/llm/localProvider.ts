import { extractJson, localChat, LOCAL_MODELS } from './local.ts';
import type { Provider, StructuredRequest, TextRequest } from './provider.ts';

/**
 * LM Studio as a Provider — the free development harness.
 *
 * LM Studio applies a JSON Schema as a decoding grammar, so even the small
 * model returns structurally valid JSON. That is what lets the entire
 * generation and turn loop be exercised end to end without an API key.
 *
 * What it CANNOT do is write Thai prose to standard: both local chat models
 * drop register instructions. Use it to prove the plumbing, not the writing.
 */
export class LocalProvider implements Provider {
  readonly name: string;
  private readonly model: string;

  constructor(model: string = LOCAL_MODELS.large) {
    this.model = model;
    this.name = `local:${model}`;
  }

  async text(req: TextRequest): Promise<string> {
    const result = await localChat(req.messages, {
      model: this.model,
      maxTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.8,
      signal: req.signal,
    });
    return result.text;
  }

  async structured<T>(req: StructuredRequest): Promise<T> {
    const result = await localChat(req.messages, {
      model: this.model,
      // Thinking tokens count against this budget and cannot be disabled on the
      // Qwen, so the ceiling has to be generous or the JSON truncates.
      maxTokens: req.maxTokens ?? 6000,
      temperature: req.temperature ?? 0.7,
      jsonSchema: { name: req.schemaName, schema: req.schema },
      signal: req.signal,
    });

    if (!result.text.trim()) {
      throw new Error(`${this.name} returned nothing for "${req.schemaName}"`);
    }
    try {
      return extractJson(result.text) as T;
    } catch (cause) {
      const head = result.text.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`${this.name} returned unparseable JSON for "${req.schemaName}": ${head}`, { cause });
    }
  }
}

/** The small, fast model. English classification and plumbing only. */
export const smallLocalProvider = (): LocalProvider => new LocalProvider(LOCAL_MODELS.small);
