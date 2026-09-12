import type { Provider } from '../llm/provider.ts';
import type { Grown, Level } from './species.ts';

/**
 * Naming what lives in a world.
 *
 * The same split `subjectnames.ts` and `classnames.ts` make: the code has already
 * decided everything that MATTERS — how many types, which ones, how they branch,
 * and what every body is worth. None of that is in this schema, because every
 * field the model does not produce is a field it cannot get wrong.
 *
 * A high-fantasy world will say elf and dwarf; a drowned coast will say its own
 * words for the same shapes. The ids never change, so a person recorded as
 * `fey.g1.s2.s1` before naming is the same creature after it.
 *
 * Like every naming call, the game can do entirely without it: a model that is
 * down or talking nonsense leaves every kind with its placeholder id for a name,
 * and the run is playable with duller words.
 */

const str = { type: 'string' } as const;

export const SPECIES_NAMING_SCHEMA = {
  type: 'object',
  properties: {
    kinds: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, name: str },
        required: ['id', 'name'],
        additionalProperties: false,
      },
    },
  },
  required: ['kinds'],
  additionalProperties: false,
} as const;

type NamingResponse = { kinds: { id: string; name: string }[] };

/** What each level is, said in the words the model needs to hear. */
const ASK: Record<Level, string> = {
  type: 'a broad kind of being — name what people here call this sort of thing',
  group: 'a family within that kind — a category, not a people',
  species: 'a PEOPLE or a breed: the name someone would actually say',
  subspecies: 'a variant of that people — a lineage, a strain, a local form',
};

/**
 * Ask for this world's words for what lives in it.
 *
 * One call for the whole tree, so the names are chosen TOGETHER: a variant has to
 * sound like a variant of its parent, which it cannot do if each is asked for
 * alone. Never throws.
 */
export async function nameSpecies(
  provider: Provider,
  nodes: readonly Grown[],
  world: string,
  language: 'th' | 'en',
): Promise<Grown[]> {
  if (nodes.length === 0) return [];

  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));

  try {
    const answer = await provider.structured<NamingResponse>({
      schemaName: 'species_naming',
      schema: SPECIES_NAMING_SCHEMA,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            `You name the kinds of being that live in a world, writing in ${language === 'th' ? 'Thai' : 'English'}.`,
            'They come as a tree: a broad kind, families within it, peoples within those, and variants of each people.',
            'A name is one to three words, the way somebody there would say it — "elf", "the deep-kin",',
            '"ash wolves". Never a sentence, never a description, never a stat.',
            'A variant must sound like a variant of the people above it, and a people like one of its kind.',
            'Every name must be DIFFERENT from every other. Return every id exactly as given, and invent none.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `The world: ${world.trim() || 'a tower, and not much else is known yet'}`,
            '',
            'Name each of these. `under` is what it belongs to:',
            ...nodes.map((n) => [
              `  ${n.id}`,
              `level: ${n.level}`,
              n.parent ? `under: ${n.parent} (${nameOf.get(n.parent) ?? n.parent})` : 'under: nothing — this is a top kind',
              ASK[n.level],
            ].join(' · ')),
          ].join('\n'),
        },
      ],
    });

    return applySpeciesNames(nodes, Array.isArray(answer?.kinds) ? answer.kinds : []);
  } catch {
    // Deliberately swallowed: duller words are a far smaller failure than a
    // creation that will not finish because a model was down.
    return [...nodes];
  }
}

/**
 * Fold the model's words in, keeping anything it got wrong out.
 *
 * A word is taken only when it is non-empty, names a node that exists, and has
 * not been used already — two kinds under one label are one kind, and the whole
 * point of the vocabulary is that a player can tell them apart.
 */
export function applySpeciesNames(
  nodes: readonly Grown[],
  named: readonly { id: string; name: string }[],
): Grown[] {
  const byId = new Map(named.map((n) => [n.id, (n.name ?? '').trim()]));
  const taken = new Set<string>();

  return nodes.map((node) => {
    const offered = byId.get(node.id) ?? '';
    const usable = offered.length > 0 && !taken.has(offered.toLowerCase());
    const name = usable ? offered : node.name;
    taken.add(name.toLowerCase());
    return { ...node, name };
  });
}
