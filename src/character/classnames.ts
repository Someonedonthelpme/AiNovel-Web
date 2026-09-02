import type { Provider } from '../llm/provider.ts';
import type { ClassShape } from './classgen.ts';
import type { ClassNaming } from './classbuild.ts';
import { STAT_BRIEF } from '../play/pathgen.ts';

/**
 * Naming a world's classes.
 *
 * The flavour half. The code has already decided everything that MATTERS —
 * hit die, abilities, which disciplines the tree may hold, where the doors go,
 * what the grants cost. None of that is in this schema, because every field
 * the model does not have to produce is a field it cannot get wrong.
 *
 * What it does is read the world the player just described and say what this
 * shape is CALLED there. A front-liner comes back a knight in a kingdom, a
 * harbour guard on a drowned coast, and whatever "stands in front and takes
 * it" happens to be in a world nobody has thought of yet. That is the whole
 * point of generating classes rather than shipping eight: the roster belongs
 * to the setting instead of the setting having to accommodate the roster.
 *
 * It is also the one generation call the game can do entirely without. If the
 * model is unavailable, slow, or returns nonsense, `buildClass` falls back to
 * role words and the run is playable with duller names — a creation page that
 * cannot render because a name did not arrive would be a far worse failure
 * than "The Standing" instead of "Harbour Guard".
 */

const str = { type: 'string' } as const;

export const CLASS_NAMING_SCHEMA = {
  type: 'object',
  properties: {
    classes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shapeId: str,
          name: str,
          description: str,
          weaponName: str,
          subclasses: {
            type: 'array',
            items: {
              type: 'object',
              properties: { shapeId: str, name: str, description: str },
              required: ['shapeId', 'name', 'description'],
              additionalProperties: false,
            },
          },
        },
        required: ['shapeId', 'name', 'description', 'weaponName', 'subclasses'],
        additionalProperties: false,
      },
    },
  },
  required: ['classes'],
  additionalProperties: false,
} as const;

type NamingResponse = { classes: ClassNaming[] };


const describe = (shape: ClassShape): string => {
  const lines = [
    `${shape.id}: someone who ${shape.brief}.`,
    `  They fight with ${shape.primary}, and lean on: ${shape.favours.map((c) => STAT_BRIEF[c]).join('; ')}.`,
    `  They lean away from: ${shape.against.map((f) => STAT_BRIEF[f]).join('; ')}.`,
    `  They set out holding a ${shape.weapon.range > 1 ? 'ranged' : 'melee'} weapon; name it for this world.`,
  ];

  for (const sub of shape.subclasses) {
    lines.push(
      sub.route === 'cross'
        ? `  ${sub.id}: a road that crosses INTO ${STAT_BRIEF[sub.opens]}, which this kind of person normally leans away from. Name what they became.`
        : `  ${sub.id}: a road that goes DEEPER into ${STAT_BRIEF[sub.opens]}, which they already lean on. Name the specialist.`,
    );
  }

  return lines.join('\n');
};

/**
 * Ask the model for the words. Never throws — an empty list is a valid answer
 * and simply means every class keeps its fallback name.
 */
export async function nameClasses(
  provider: Provider,
  shapes: readonly ClassShape[],
  world: string,
  language: 'th' | 'en',
): Promise<ClassNaming[]> {
  if (shapes.length === 0) return [];

  try {
    const answer = await provider.structured<NamingResponse>({
      schemaName: 'class_naming',
      schema: CLASS_NAMING_SCHEMA,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            `You name character classes for a game, writing in ${language === 'th' ? 'Thai' : 'English'}.`,
            'You are given the MECHANICS of each class and the world it belongs to. Do not change the mechanics — name them.',
            'A name must belong to the world described. In a kingdom a front-liner might be a Knight; on a drowned coast, a Harbour Guard; after a collapse, a Wall Sergeant.',
            'Never use the words Fighter, Wizard, Rogue, Cleric, Bard, Barbarian, Ranger, Warlock, Paladin, Monk, Druid or Sorcerer. Those belong to a different game.',
            'A name is two or three words at most. A description is ONE sentence, second person, saying what this person does and what it costs them.',
            'Subclass names must sound like a path taken, not a job title.',
            'Return every id you were given, spelled exactly as given. Never invent an id.',
            'Write complete sentences. Never trail off with an ellipsis.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `The world: ${world.trim() || 'a tower, and not much else is known yet'}`,
            '',
            'Name each of these, and each of their paths:',
            '',
            ...shapes.map(describe),
          ].join('\n'),
        },
      ],
    });

    return Array.isArray(answer?.classes) ? answer.classes : [];
  } catch {
    // Deliberately swallowed. The roster is playable without names, and a
    // creation page that will not render because the model was down is a
    // worse failure than a duller word.
    return [];
  }
}
