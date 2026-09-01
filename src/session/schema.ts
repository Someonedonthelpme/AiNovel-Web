import { ABILITIES } from '../combat/types.ts';
import { PLACE_KINDS } from '../world/types.ts';
import { SKILL_KINDS } from './sheet.ts';

/**
 * JSON Schemas for the generation calls.
 *
 * LM Studio applies these as a decoding grammar, so structure is guaranteed
 * even from a small local model. Semantics are not — that is what `repair.ts`
 * and the validators are for.
 *
 * Anything the code can decide is deliberately NOT in these schemas: region id,
 * floor number, danger and detail level are all filled in afterwards, because
 * every field the model does not have to produce is a field it cannot get
 * wrong.
 */

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: { type: 'string' } } as const;

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const abilityScores = obj(
  Object.fromEntries(ABILITIES.map((a) => [a, { type: 'integer', minimum: 8, maximum: 15 }])),
  [...ABILITIES],
);

const skill = obj(
  {
    id: str,
    name: str,
    description: str,
    ability: { type: 'string', enum: [...ABILITIES] },
    kind: { type: 'string', enum: [...SKILL_KINDS] },
  },
  ['id', 'name', 'description', 'ability', 'kind'],
);

const item = obj({ id: str, name: str, description: str }, ['id', 'name', 'description']);

const attack = obj(
  {
    id: str,
    name: str,
    ability: { type: 'string', enum: [...ABILITIES] },
    proficient: { type: 'boolean' },
    /** In 5-foot squares. Melee reach is 1, NOT 5. */
    range: { type: 'integer', minimum: 1, maximum: 20 },
    damage: obj(
      {
        count: { type: 'integer', minimum: 1, maximum: 4 },
        sides: { type: 'integer', enum: [4, 6, 8, 10, 12] },
        bonusAbility: { type: 'string', enum: [...ABILITIES] },
        type: str,
      },
      ['count', 'sides', 'bonusAbility', 'type'],
    ),
  },
  ['id', 'name', 'ability', 'proficient', 'range', 'damage'],
);

export const CHARACTER_SCHEMA = obj(
  {
    name: str,
    traits: { type: 'array', items: str, minItems: 2, maxItems: 5 },
    hitDie: { type: 'integer', enum: [6, 8, 10, 12] },
    voice: obj({ selfPronoun: str, underStress: str }, ['selfPronoun', 'underStress']),
    personality: obj(
      {
    warmth: { type: 'integer', minimum: -3, maximum: 3 },
    nerve: { type: 'integer', minimum: -3, maximum: 3 },
    discipline: { type: 'integer', minimum: -3, maximum: 3 },
    candour: { type: 'integer', minimum: -3, maximum: 3 },
    loyalty: { type: 'integer', minimum: -3, maximum: 3 },
      },
      ['warmth', 'nerve', 'discipline', 'candour', 'loyalty'],
    ),
    baseAbilities: abilityScores,
    background: obj(
      {
        id: str,
        name: str,
        description: str,
        grantsStats: obj(
          Object.fromEntries(ABILITIES.map((a) => [a, { type: 'integer', minimum: 0, maximum: 2 }])),
          [],
        ),
        grantsSkills: { type: 'array', items: skill, minItems: 2, maxItems: 5 },
        startingGear: { type: 'array', items: item, maxItems: 5 },
        startingAttacks: { type: 'array', items: attack, minItems: 1, maxItems: 3 },
        socialStanding: { type: 'string', enum: ['superior', 'peer', 'inferior'] },
      },
      ['id', 'name', 'description', 'grantsStats', 'grantsSkills', 'startingGear', 'startingAttacks', 'socialStanding'],
    ),
  },
  ['name', 'traits', 'hitDie', 'voice', 'personality', 'baseAbilities', 'background'],
);

const place = obj(
  {
    id: str,
    name: str,
    kind: { type: 'string', enum: [...PLACE_KINDS] },
    description: str,
    connections: strArray,
    people: strArray,
    affordances: { type: 'array', items: str, minItems: 1, maxItems: 5 },
  },
  ['id', 'name', 'kind', 'description', 'connections', 'people', 'affordances'],
);

/**
 * Voice is asked for as FLAT fields rather than nested trust bands: a model can
 * pick five pronouns reliably, but reliably keying a record by trust floor is a
 * different matter. `genesis.ts` assembles the bands.
 */
const personSchema = obj(
  {
    id: str,
    name: str,
    oneLine: str,
    tags: strArray,
    trust: { type: 'integer', minimum: -3, maximum: 4 },
    status: { type: 'string', enum: ['superior', 'peer', 'inferior'] },
    selfPronoun: str,
    underStress: str,
    addressDistant: str,
    addressWarm: str,
    particleDistant: str,
    particleWarm: str,
    warmth: { type: 'integer', minimum: -3, maximum: 3 },
    nerve: { type: 'integer', minimum: -3, maximum: 3 },
    discipline: { type: 'integer', minimum: -3, maximum: 3 },
    candour: { type: 'integer', minimum: -3, maximum: 3 },
    loyalty: { type: 'integer', minimum: -3, maximum: 3 },
  },
  ['id', 'name', 'oneLine', 'tags', 'trust', 'status', 'selfPronoun', 'underStress',
   'addressDistant', 'addressWarm', 'particleDistant', 'particleWarm',
   'warmth', 'nerve', 'discipline', 'candour', 'loyalty'],
);

export const GROUND_FLOOR_SCHEMA = obj(
  {
    premise: str,
    region: obj(
      {
        name: str,
        biome: str,
        culture: str,
        places: { type: 'array', items: place, minItems: 3, maxItems: 6 },
        entrance: str,
        exit: str,
      },
      ['name', 'biome', 'culture', 'places', 'entrance', 'exit'],
    ),
    people: { type: 'array', items: personSchema, minItems: 1, maxItems: 4 },
  },
  ['premise', 'region', 'people'],
);

/* -------------------------------------------------------------------------- */
/* The shapes those schemas produce                                            */
/* -------------------------------------------------------------------------- */

export type GeneratedCharacter = {
  name: string;
  traits: string[];
  hitDie: number;
  voice: { selfPronoun: string; underStress: string };
  personality: {
    warmth: number;
    nerve: number;
    discipline: number;
    candour: number;
    loyalty: number;
  };
  baseAbilities: Record<string, number>;
  background: {
    id: string;
    name: string;
    description: string;
    grantsStats: Record<string, number>;
    grantsSkills: { id: string; name: string; description: string; ability: string; kind: string }[];
    startingGear: { id: string; name: string; description: string }[];
    startingAttacks: unknown[];
    socialStanding: string;
  };
};

export type GeneratedGroundFloor = {
  premise: string;
  region: {
    name: string;
    biome: string;
    culture: string;
    places: {
      id: string;
      name: string;
      kind: string;
      description: string;
      connections: string[];
      people: string[];
      affordances: string[];
    }[];
    entrance: string;
    exit: string;
  };
  people: {
    id: string;
    name: string;
    oneLine: string;
    tags: string[];
    trust: number;
    status: string;
    selfPronoun: string;
    underStress: string;
    addressDistant: string;
    addressWarm: string;
    particleDistant: string;
    particleWarm: string;
    warmth: number;
    nerve: number;
    discipline: number;
    candour: number;
    loyalty: number;
  }[];
};
