import type { Provider } from '../llm/provider.ts';
import type { Role } from './roles.ts';

/**
 * Naming what two people are to each other.
 *
 * The flavour half, and the same split `subjectnames.ts` makes: the code has
 * already decided everything that MATTERS — what is owed, what is allowed, what
 * the axes open at, and which end owes which. None of that is in this schema,
 * because every field the model does not produce is a field it cannot get wrong.
 *
 * WHAT IT IS FOR is worth stating plainly, because "let the model name things"
 * sounds like decoration and is not. A matrilineal world inherits through the
 * mother's brother; the right WORD for that is "uncle" and the wrong shape
 * comes with it. Here the shape is fixed by the template and only the word is
 * asked for, so a world can call an inheriting elder "mother's-brother" and the
 * engine still answers "who inherits?" correctly.
 *
 * Both ends are asked for at once, because they are one relationship: "father"
 * and "child" have to be chosen together or they will not fit each other.
 *
 * Like every naming call, the game does entirely without it — an unavailable
 * model costs a world its words and nothing else.
 */

const str = { type: 'string' } as const;

export const ROLE_NAMING_SCHEMA = {
  type: 'object',
  properties: {
    roles: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: str, a: str, b: str },
        required: ['id', 'a', 'b'],
        additionalProperties: false,
      },
    },
  },
  required: ['roles'],
  additionalProperties: false,
} as const;

type NamingResponse = { roles: { id: string; a: string; b: string }[] };

/**
 * What each template MEANS, in a sentence the model can name from.
 *
 * Deliberately describes the mechanics rather than a fantasy example: the point
 * is that a world invents its own word for "the elder who passes things down",
 * not that it picks from a list of nouns somebody already thought of.
 */
const BRIEF: Record<Role['kind'], string> = {
  kin: 'blood. The first shelters and passes things down; the second owes obedience and support.',
  bonded: 'two people bound into one household. Symmetric: shelter, support and discretion both ways.',
  power: 'one commands and keeps; the other obeys and is kept.',
  exchange: 'one is owed money or goods; the other owes it. It ends when it is settled.',
  sworn: 'chosen kin — the obligations of blood between people who are not blood. Symmetric.',
  lifeDebt: 'the first saved the second’s life, and both of them know it.',
  feud: 'a standing quarrel with blood in it. Symmetric, and hostile from the start.',
  custodial: 'the first has charge of the second’s wellbeing: a carer, a healer, a guardian.',
  made: 'the first made or summoned the second, who owes obedience for it.',
  professional: 'the first pays; the second does the work.',
  host: 'the first offers shelter and safety; the second is expected to be discreet.',
};

export async function nameRoles(
  provider: Provider,
  roles: readonly Role[],
  world: string,
  language: 'th' | 'en',
): Promise<Role[]> {
  if (roles.length === 0) return [];

  try {
    const answer = await provider.structured<NamingResponse>({
      schemaName: 'role_naming',
      schema: ROLE_NAMING_SCHEMA,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            `You name what people in a world are to one another, writing in ${language === 'th' ? 'Thai' : 'English'}.`,
            'Each relationship has TWO ENDS and you name both. They must fit each other the way',
            '"father" fits "daughter" and "creditor" fits "debtor" — one word each, or a short phrase.',
            'Name them as this world would: a title, a kinship term, a station. Never a sentence,',
            'never a description, never a name for one particular person.',
            'The two ends of a symmetric bond may share a word ("spouse", "oath-brother").',
            'Every id must come back exactly as given, and you may invent none.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `The world: ${world.trim() || 'a tower, and not much else is known yet'}`,
            '',
            'Name both ends of each of these:',
            ...roles.map((r) => `  ${r.id}: ${BRIEF[r.kind]}`),
          ].join('\n'),
        },
      ],
    });

    return applyRoleNames(roles, Array.isArray(answer?.roles) ? answer.roles : []);
  } catch {
    // Deliberately swallowed, like every other naming call.
    return [...roles];
  }
}

/**
 * Fold the words in, keeping anything the model got wrong out.
 *
 * Both ends must arrive together or neither is taken: half a pair is worse than
 * none of it, because "father ↔ younger kin" reads as a bug rather than as a
 * world that has not been named.
 */
export function applyRoleNames(
  roles: readonly Role[],
  named: readonly { id: string; a: string; b: string }[],
): Role[] {
  const byId = new Map(named.map((n) => [n.id, n]));

  return roles.map((role) => {
    const offered = byId.get(role.id);
    const a = (offered?.a ?? '').trim();
    const b = (offered?.b ?? '').trim();
    return a && b ? { ...role, names: [a, b] as [string, string] } : role;
  });
}
