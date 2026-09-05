import type { Provider } from '../llm/provider.ts';
import type { Subject } from './subjects.ts';

/**
 * Naming what a world is about.
 *
 * The flavour half, and the same split `classnames.ts` makes: the code has
 * already decided everything that MATTERS — how many subjects, of what kinds,
 * and the ids that a drive and a piece of lore will match on. None of that is
 * in this schema, because every field the model does not produce is a field it
 * cannot get wrong.
 *
 * NAMING IS PURELY COSMETIC TO THE MECHANICS, and that is worth stating
 * plainly: a subject's `id` never changes, so a drive chosen before naming and
 * a history written after it still point at the same thing. What changes is
 * whether the world sounds like itself. A drowned coast should turn on "the
 * flood" and "the old highways", not on "the long quarrel" — and the fallback
 * words, being setting-neutral by design, are exactly as bland as that.
 *
 * Like `nameClasses`, this is a call the game can do entirely without: if the
 * model is unavailable or returns nonsense, every subject keeps its fallback
 * word and the run is playable with duller names.
 */

const str = { type: 'string' } as const;

export const SUBJECT_NAMING_SCHEMA = {
  type: 'object',
  properties: {
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, name: str },
        required: ['id', 'name'],
        additionalProperties: false,
      },
    },
  },
  required: ['subjects'],
  additionalProperties: false,
} as const;

type NamingResponse = { subjects: { id: string; name: string }[] };

/**
 * Ask for this world's words. Never throws — an empty list means every subject
 * keeps the word it already had.
 */
export async function nameSubjects(
  provider: Provider,
  subjects: readonly Subject[],
  world: string,
  language: 'th' | 'en',
): Promise<Subject[]> {
  if (subjects.length === 0) return [];

  try {
    const answer = await provider.structured<NamingResponse>({
      schemaName: 'subject_naming',
      schema: SUBJECT_NAMING_SCHEMA,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            `You name the things a world turns on, writing in ${language === 'th' ? 'Thai' : 'English'}.`,
            'You are given a KIND for each — a war, a house, a craft — and you say what that is CALLED here.',
            'A name is a noun phrase of two to five words, the way people in this world would refer to it.',
            'It should sound like something people already know about and do not explain: "the flood",',
            '"the Verrin line", "the salt road". Never a sentence, never a description.',
            'These are what characters want, fear, and tell stories about — so each must be worth caring about.',
            'Every name must be DIFFERENT from every other. Return every id exactly as given, and invent none.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `The world: ${world.trim() || 'a tower, and not much else is known yet'}`,
            '',
            'Name each of these:',
            ...subjects.map((s) => `  ${s.id}: ${s.kind}`),
          ].join('\n'),
        },
      ],
    });

    return applyNames(subjects, Array.isArray(answer?.subjects) ? answer.subjects : []);
  } catch {
    // Deliberately swallowed. A world with duller words is a far smaller
    // failure than a creation that will not finish because a model was down.
    return [...subjects];
  }
}

/**
 * Fold the model's words in, keeping anything it got wrong out.
 *
 * A name is taken only when it is non-empty, names a subject that exists, and
 * has not already been used — two subjects under one label are one subject, and
 * the whole point of the vocabulary is that they are distinguishable.
 */
export function applyNames(
  subjects: readonly Subject[],
  named: readonly { id: string; name: string }[],
): Subject[] {
  const byId = new Map(named.map((n) => [n.id, (n.name ?? '').trim()]));
  const taken = new Set<string>();
  const out: Subject[] = [];

  for (const subject of subjects) {
    const offered = byId.get(subject.id) ?? '';
    const usable = offered.length > 0 && !taken.has(offered.toLowerCase());
    const name = usable ? offered : subject.name;
    taken.add(name.toLowerCase());
    out.push({ ...subject, name });
  }
  return out;
}
