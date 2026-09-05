import { openingEdges } from '../social/edge.ts';
import type { Edges } from '../social/edge.ts';
import type { Provider } from '../llm/provider.ts';
import { clampTemperament, neutralTemperament, metNeeds } from '../character/persona.ts';
import { repairRegion, repairVoice } from '../session/repair.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { humanisePlaces, pruneDangling } from './naming.ts';
import { dangerFor, peopleBudget, placeBudget, settlementBudget } from './budget.ts';
import { rehydrationBrief } from './lod.ts';
import type { Gazetteer, Person, Place, PlaceKind, Region, World } from './types.ts';
import { PLACE_KINDS, regionIdFor } from './types.ts';
import { validateRegion } from './validate.ts';

/**
 * Generating a tower floor.
 *
 * Two jobs share this code, and the difference matters:
 *  - a NEW floor is invented from depth and the world's tone;
 *  - a RETURN to a compressed floor is a REHYDRATION — the gazetteer is canon
 *    and the rebuilt detail has to agree with it, or it is a similar place
 *    rather than the same one.
 *
 * As everywhere else: the model supplies flavour, the code supplies structure.
 * Floor number, danger, ids and detail level are filled in here, because a field
 * the model never sees is a field it cannot get wrong.
 */

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: { type: 'string' } } as const;

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const placeSchema = obj(
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
    intuition: { type: 'integer', minimum: -3, maximum: 3 },
    feeling: { type: 'integer', minimum: -3, maximum: 3 },
    nerve: { type: 'integer', minimum: -3, maximum: 3 },
    discipline: { type: 'integer', minimum: -3, maximum: 3 },
  },
  ['id', 'name', 'oneLine', 'tags', 'trust', 'status', 'selfPronoun', 'underStress',
   'addressDistant', 'addressWarm', 'particleDistant', 'particleWarm',
   'intuition', 'feeling', 'nerve', 'discipline'],
);

/** Sized per floor, because the budget grows with depth. */
export function floorSchema(floor: number) {
  const places = placeBudget(floor);
  const people = peopleBudget(floor);
  return obj(
    {
      name: str,
      biome: str,
      culture: str,
      places: { type: 'array', items: placeSchema, minItems: places.min, maxItems: places.max },
      entrance: str,
      exit: str,
      people: { type: 'array', items: personSchema, minItems: 0, maxItems: people.max },
      /** Local ecology — names only; the numbers come from `statblock.ts`. */
      creatures: { type: 'array', items: str, minItems: 1, maxItems: 4 },
    },
    ['name', 'biome', 'culture', 'places', 'entrance', 'exit', 'people', 'creatures'],
  );
}

export type GeneratedFloor = {
  name: string;
  biome: string;
  culture: string;
  places: {
    id: string; name: string; kind: string; description: string;
    connections: string[]; people: string[]; affordances: string[];
  }[];
  entrance: string;
  exit: string;
  people: {
    id: string; name: string; oneLine: string; tags: string[]; trust: number; status: string;
    selfPronoun: string; underStress: string; addressDistant: string; addressWarm: string;
    particleDistant: string; particleWarm: string;
    intuition: number; feeling: number; nerve: number; discipline: number;
  }[];
  creatures: string[];
};

export type FloorResult = {
  region: Region;
  people: Record<string, Person>;
  /**
   * What everyone newly arrived on this floor already thinks of the player.
   *
   * Only the ARRIVALS' edges, not the whole graph — merging beats replacing,
   * or a crossing would wipe out every relationship earned before it.
   */
  edges: Edges;
  /** Names for whatever lives here; encounters take their numbers from depth. */
  creatures: string[];
  repairs: string[];
  warnings: string[];
};

const asPlaceKind = (v: string): PlaceKind =>
  (PLACE_KINDS as readonly string[]).includes(v) ? (v as PlaceKind) : 'landmark';

const LANGUAGE_NAME = { th: 'Thai', en: 'English' } as const;

function styleRule(language: 'th' | 'en'): string {
  if (language !== 'th') return 'Write all names and prose in English.';
  return [
    'Write ALL names, descriptions and creature names natively in Thai.',
    'Do not translate from English, invent them in Thai directly.',
    'Each voice field is ONE Thai word. Never a pair, never a slash.',
  ].join(' ');
}

function systemPrompt(floor: number, language: 'th' | 'en', settlements: { min: number; max: number }): string {
  return [
    `You are building floor ${floor} of an endless tower, in ${LANGUAGE_NAME[language]}.`,
    styleRule(language),
    `This floor is a REGION with its own biome and character. Danger level ${dangerFor(floor)}.`,
    'Deeper floors are stranger and more hostile than shallow ones.',
    'One place is the arrival point from the floor below, and one is the way up;',
    'both have kind "gate", and they must be different places.',
    'Every connection must be listed on BOTH places it joins.',
    'Affordances are concrete things a player can do there, not descriptions.',
    settlements.max === 0
      ? 'This floor is wild: no settlement, and few or no people.'
      : `At most ${settlements.max} place(s) may have kind "settlement".`,
    'Every id in a place\'s people list must be an id in the people array.',
    '"creatures" names what lives and hunts here. Names only, no statistics.',
    'Every person needs a disposition, each from -3 to +3:',
    '  intuition: literal and concrete (-3) to imaginative and abstract (+3)',
    '  feeling: coldly logical (-3) to led by what matters to them (+3)',
    '  nerve: easily frightened (-3) to fearless (+3)',
    '  discipline: impulsive (-3) to rigidly controlled (+3)',
    '  candour: evasive and deceitful (-3) to blunt to a fault (+3)',
    '  loyalty: would sell you out (-3) to would die for a friend (+3)',
    'Make them differ from each other. A town of identical dispositions is a town of nobody.',
    'underStress is what they call themselves when frightened or furious.',
  ].join('\n');
}

function userPrompt(
  floor: number,
  world: World,
  sheet: CharacterSheet,
  gazetteer: Gazetteer | null,
  canon: { people: string[]; facts: string[] },
): string {
  if (gazetteer) {
    return [
      `The climber is returning to floor ${floor}, which they have visited before.`,
      'Rebuild it CONSISTENTLY with what is already known. This is the same place,',
      'not a similar one. Anything below is already true and cannot be contradicted:',
      '',
      `Name: ${gazetteer.name}`,
      `Biome: ${gazetteer.biome}`,
      `Known: ${gazetteer.summary}`,
      gazetteer.openThreads.length ? `Unfinished business: ${gazetteer.openThreads.join('; ')}` : '',
      canon.people.length ? `People who belong here: ${canon.people.join('; ')}` : '',
      canon.facts.length ? `Established facts:\n${canon.facts.map((f) => `- ${f}`).join('\n')}` : '',
      '',
      'Reuse those people by the same ids and names. You may add detail, never replace it.',
    ].filter(Boolean).join('\n');
  }

  const belowName = Object.values(world.regions).find((r) => r.floor === floor - 1)?.name;
  return [
    `Build floor ${floor}, newly reached.`,
    belowName ? `The floor below was "${belowName}".` : '',
    `The world: ${world.regions[regionIdFor(0)]?.name ?? ''}.`,
    `The climber is ${sheet.name}, ${sheet.background.name}.`,
    'Make this floor feel unlike the one below it.',
  ].filter(Boolean).join('\n');
}

export async function generateFloor(
  provider: Provider,
  world: World,
  floor: number,
  sheet: CharacterSheet,
  gazetteer: Gazetteer | null = null,
): Promise<FloorResult> {
  if (floor < 1) throw new Error(`floor ${floor} is not inside the tower`);

  const canon = gazetteer
    ? rehydrationBrief(world, gazetteer)
    : { people: [], facts: [] as string[] };

  const generated = await provider.structured<GeneratedFloor>({
    schemaName: `floor_${floor}`,
    schema: floorSchema(floor),
    temperature: 0.9,
    messages: [
      { role: 'system', content: systemPrompt(floor, world.language, settlementBudget(floor)) },
      {
        role: 'user',
        content: userPrompt(floor, world, sheet, gazetteer, {
          people: 'people' in canon ? canon.people.map((p) => `${p.id} "${p.name}": ${p.oneLine}`) : [],
          facts: canon.facts,
        }),
      },
    ],
  });

  const regionId = regionIdFor(floor);
  const rawPlaces: Place[] = generated.places.map((p) => ({
    id: p.id,
    name: p.name,
    kind: asPlaceKind(p.kind),
    description: p.description,
    connections: p.connections,
    people: p.people,
    affordances: p.affordances,
    discovered: false,
  }));

  const places = rawPlaces;

  const draft: Region = {
    detail: 'full',
    id: regionId,
    floor,
    name: gazetteer?.name ?? generated.name,
    biome: gazetteer?.biome ?? generated.biome,
    culture: generated.culture,
    danger: dangerFor(floor),
    places,
    entrance: generated.entrance,
    exit: generated.exit,
    creatures: generated.creatures,
  };

  const repaired = repairRegion(draft);
  const repairs = [...repaired.repairs];

  // People who already exist keep their real state; only new ones are created.
  const people: Record<string, Person> = {};
  // And only NEW people open an edge — a returning face keeps what it earned.
  const arrivals: { id: string; trust: number }[] = [];
  for (const p of generated.people) {
    const existing = world.people[p.id];
    if (existing) {
      people[p.id] = existing;
      continue;
    }
    arrivals.push({ id: p.id, trust: p.trust });
    people[p.id] = {
      id: p.id,
      name: p.name,
      homeRegion: regionId,
      oneLine: p.oneLine,
      tags: p.tags,
      alive: true,
      lastSeenTurn: world.turn,
      status: p.status === 'superior' || p.status === 'inferior' ? p.status : 'peer',
      voice: repairVoice({
        selfPronoun: p.selfPronoun,
        underStress: p.underStress,
        addressBands: { '-3': p.addressDistant, '2': p.addressWarm },
        particleBands: { '-3': p.particleDistant, '2': p.particleWarm },
        tics: [],
      }).value,
      // Written on the narrow scale a model can hold in its head, stored on
      // the wide one drift and the skill formulas need.
      temperament: clampTemperament({
        intuition: p.intuition * 3, feeling: p.feeling * 3,
        nerve: p.nerve * 3, discipline: p.discipline * 3,
      }),
      needs: metNeeds(),
      counters: {},
      pressure: neutralTemperament(),
    };
  }
  // A rehydrated floor keeps everyone it had, even if the model forgot them.
  for (const id of gazetteer?.knownPeople ?? []) {
    if (!people[id] && world.people[id]) people[id] = world.people[id];
  }

  const known = new Set(Object.keys(people));
  const dropped: string[] = [];
  const region: Region = {
    ...repaired.value,
    places: repaired.value.places.map((place) => {
      const kept = place.people.filter((id) => {
        if (known.has(id)) return true;
        dropped.push(`${place.id}:${id}`);
        return false;
      });
      return kept.length === place.people.length ? place : { ...place, people: kept };
    }),
  };
  if (dropped.length) repairs.push(`dropped undefined people: ${dropped.join(', ')}`);

  // A floor you cannot leave is a floor you are trapped on.
  if (region.exit === null || region.exit === region.entrance) {
    const candidate =
      region.places.find((p) => p.kind === 'gate' && p.id !== region.entrance) ??
      region.places.find((p) => p.id !== region.entrance);
    if (candidate) {
      region.exit = candidate.id;
      repairs.push(`floor ${floor} had no distinct way up; adopted "${candidate.id}"`);
    }
  }

  // See `humanisePlaces`: generated ids leak into affordances and description,
  // and the Writer echoes whatever it is shown.
  region.places = humanisePlaces(region.places, people);

  // ...and drop any action still pointing at somebody who was never created.
  // "listen to storyteller1" cannot be repaired by substitution — there is no
  // name — and an action naming a person who does not exist is worse than one
  // fewer suggestion, because the player will try it.
  const pruned = pruneDangling(region.places, people);
  region.places = pruned.places;
  if (pruned.dropped.length) repairs.push(`dropped actions naming nobody: ${pruned.dropped.join(', ')}`);

  const check = validateRegion(region, people);
  if (!check.ok) {
    throw new Error(`generated floor ${floor} is unplayable: ${check.errors.map((e) => e.message).join('; ')}`);
  }

  return {
    region,
    people,
    edges: openingEdges({}, arrivals),
    creatures: generated.creatures,
    repairs,
    warnings: check.warnings.map((w) => w.message),
  };
}
