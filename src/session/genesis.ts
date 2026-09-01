import type { Attack } from '../combat/types.ts';
import type { Provider } from '../llm/provider.ts';
import { keepsake, stripMechanics } from '../items/catalogue.ts';
import { humanisePlaces, pruneDangling } from '../world/naming.ts';
import type { Person, Place, PlaceKind, Region, World } from '../world/types.ts';
import { PLACE_KINDS } from '../world/types.ts';
import { validateRegion } from '../world/validate.ts';
import type { Interview } from './interview.ts';
import { isComplete, transcript } from './interview.ts';
import { clampPersonality, neutralPersonality, restingMind } from '../character/persona.ts';
import { repairAbilities, repairRegion, repairVoice } from './repair.ts';
import type { GeneratedCharacter, GeneratedGroundFloor } from './schema.ts';
import { CHARACTER_SCHEMA, GROUND_FLOOR_SCHEMA } from './schema.ts';
import type { Background, CharacterSheet, Skill, SkillKind } from './sheet.ts';
import { validateSheet } from './sheet.ts';
import { sword } from '../combat/fixtures.ts';

/**
 * Session Zero generation: an interview in, a validated character and ground
 * floor out.
 *
 * The model supplies flavour and the code supplies structure. Anything derivable
 * is filled in here rather than asked for, anything checkable is checked, and
 * anything mechanically fixable is repaired rather than retried.
 */

const LANGUAGE_NAME = { th: 'Thai', en: 'English' } as const;

function styleRule(language: 'th' | 'en'): string {
  if (language !== 'th') {
    return [
      'Write all names and prose in English.',
      'voice.selfPronoun is the word this character uses for themselves when speaking, so in English it is "I".',
      'voice.underStress is the same but when angry or frightened. Never a pronoun set like "she/her".',
    ].join(' ');
  }
  return [
    'Write ALL names, descriptions and skill names natively in Thai.',
    'Do not translate from English, invent them in Thai directly.',
    'voice.selfPronoun is the Thai first-person pronoun this character uses for themselves',
    '(for example the polite male, polite female, or humble forms), chosen to suit their status and manner.',
    'voice.underStress is the blunt pronoun they fall into when angry or frightened.',
    'Both must be single Thai pronouns, never a pronoun set and never English.',
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Character                                                                   */
/* -------------------------------------------------------------------------- */

const asSkillKind = (v: string): SkillKind => (v === 'combat' || v === 'social' ? v : 'utility');

const asAbility = (v: string) =>
  (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).includes(v as never) ? (v as Skill['ability']) : 'str';

export type CharacterGenesis = {
  sheet: CharacterSheet;
  repairs: string[];
  warnings: string[];
};

export async function generateCharacter(provider: Provider, interview: Interview): Promise<CharacterGenesis> {
  if (!isComplete(interview)) throw new Error('the interview is not finished');

  const { language, draft } = interview;
  const pinned = [
    draft.name ? `The character is named "${draft.name}".` : '',
    draft.backgroundName ? `Their background must be "${draft.backgroundName}".` : '',
    draft.traits?.length ? `They must have these traits: ${draft.traits.join(', ')}.` : '',
    draft.baseAbilities ? 'Ability scores are already fixed; propose anything and it will be ignored.' : '',
  ].filter(Boolean);

  const generated = await provider.structured<GeneratedCharacter>({
    schemaName: 'character',
    schema: CHARACTER_SCHEMA,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: [
          `You are a game master building a first-level character in ${LANGUAGE_NAME[language]}.`,
          styleRule(language),
          'The background must grant its OWN distinct skills — not generic ones a different background would also have.',
          '"name" is the CHARACTER personal name. Never the world, the place, or the background.',
          'Skills must be specific to THIS background and named for what this person actually learned.',
          'Never use generic skill names such as Athletics, Insight, Perception or Persuasion.',
          'Skill "kind" must match the skill: physical actions are combat or utility, never social.',
          'Attack "range" is in 5-foot squares, so a melee weapon has range 1. It is not a distance in feet.',
          'Write complete descriptions. Never trail off with an ellipsis.',
          'Ability scores use point buy: each score 8-15, costing 0,1,2,3,4,5,7,9 respectively, 27 points total.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Session Zero interview:',
          '',
          transcript(interview),
          ...(pinned.length ? ['', 'Fixed by the player, do not contradict:', ...pinned] : []),
        ].join('\n'),
      },
    ],
  });

  const abilities = repairAbilities(draft.baseAbilities ?? (generated.baseAbilities as never));

  const background: Background = {
    id: generated.background.id,
    name: draft.backgroundName ?? generated.background.name,
    description: generated.background.description,
    grantsStats: generated.background.grantsStats as Background['grantsStats'],
    grantsSkills: generated.background.grantsSkills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      ability: asAbility(s.ability),
      kind: asSkillKind(s.kind),
    })),
    // Flavour from the model, mechanics from the code: see `keepsake`.
    startingGear: generated.background.startingGear.map((g) => keepsake(g.id, g.name, stripMechanics(g.description))),
    startingAttacks: (generated.background.startingAttacks as Attack[]).length
      ? (generated.background.startingAttacks as Attack[])
      : [sword],
    socialStanding:
      generated.background.socialStanding === 'superior' || generated.background.socialStanding === 'inferior'
        ? generated.background.socialStanding
        : 'peer',
  };

  const sheet: CharacterSheet = {
    name: draft.name ?? generated.name,
    language,
    background,
    baseAbilities: abilities.value,
    traits: draft.traits ?? generated.traits,
    level: 1,
    hitDie: [6, 8, 10, 12].includes(generated.hitDie) ? generated.hitDie : 8,
    voice: repairVoice({
      selfPronoun: generated.voice.selfPronoun,
      underStress: generated.voice.underStress,
      // The player chooses how to address people turn by turn, so their own
      // bands stay open rather than being fixed at generation.
      addressBands: {},
      particleBands: {},
      tics: [],
    }).value,
    status: background.socialStanding,
    personality: clampPersonality(generated.personality ?? {}),
    mental: restingMind(),
    counters: {},
    pressure: neutralPersonality(),
  };

  const check = validateSheet(sheet);
  if (!check.ok) throw new Error(`generated character is invalid: ${check.errors.join('; ')}`);

  return { sheet, repairs: abilities.repairs, warnings: check.warnings };
}

/* -------------------------------------------------------------------------- */
/* Ground floor                                                                */
/* -------------------------------------------------------------------------- */

const asPlaceKind = (v: string): PlaceKind =>
  (PLACE_KINDS as readonly string[]).includes(v) ? (v as PlaceKind) : 'landmark';

export type WorldGenesis = {
  region: Region;
  people: Record<string, Person>;
  premise: string;
  /** Where the player opens the game. Not necessarily the entrance. */
  startPlace: string;
  repairs: string[];
  warnings: string[];
};

/**
 * Where the game opens.
 *
 * The entrance is a gate, and gates are naturally deserted — which produced an
 * opening turn with nobody to talk to, no affordances worth using, and no way to
 * climb. The character LIVES in this town; they should begin in it, not in its
 * doorway. The entrance still means "the way in from outside"; only the starting
 * position changes.
 */
function chooseStartPlace(region: Region): string {
  const lively = region.places.find((p) => p.kind === 'settlement' && p.people.length > 0);
  if (lively) return lively.id;
  const settlement = region.places.find((p) => p.kind === 'settlement');
  if (settlement) return settlement.id;
  const populated = region.places.find((p) => p.people.length > 0);
  return populated?.id ?? region.entrance;
}

export async function generateGroundFloor(
  provider: Provider,
  interview: Interview,
  sheet: CharacterSheet,
): Promise<WorldGenesis> {
  const { language } = interview;

  const generated = await provider.structured<GeneratedGroundFloor>({
    schemaName: 'ground_floor',
    schema: GROUND_FLOOR_SCHEMA,
    temperature: 0.9,
    messages: [
      {
        role: 'system',
        content: [
          `You are building the ground-level town at the foot of a tower, in ${LANGUAGE_NAME[language]}.`,
          styleRule(language),
          'This is ONLY the ground-level town OUTSIDE the tower.',
          'Do not include any floor, hall or staircase inside the tower itself — just the stair that leads up to it.',
          'Exactly one place must have kind "settlement". The player BEGINS there,',
          'so it must be the liveliest place on the map: put most of the people in it,',
          'and give it affordances worth spending a first turn on.',
          'One place is the way in from outside and one is the stair up into the tower; both have kind "gate".',
          'Every connection must be listed on BOTH places it joins.',
          'Affordances are concrete things a player can do there, not descriptions.',
          'Every id in a place\'s people list must be an id in the people array.',
          'Each person needs a voice: selfPronoun is what they call themselves;',
          'addressDistant and particleDistant are how they speak to a stranger;',
          'addressWarm and particleWarm are how they speak once they trust someone.',
          'The two pairs must differ - that shift is how the player hears trust change.',
          'Every person needs a disposition, each from -3 to +3:',
          '  warmth: cold and guarded (-3) to open and generous (+3)',
          '  nerve: easily frightened (-3) to fearless (+3)',
          '  discipline: impulsive (-3) to rigidly controlled (+3)',
          '  candour: evasive and deceitful (-3) to blunt to a fault (+3)',
          '  loyalty: would sell you out (-3) to would die for a friend (+3)',
          'Make them differ from each other. A town of identical dispositions is a town of nobody.',
          'underStress is what they call themselves when frightened or furious.',
          'Each of these is ONE word. Never a pair, never a slash, never alternatives.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Session Zero interview:',
          '',
          transcript(interview),
          '',
          `The player character is ${sheet.name}, ${sheet.background.name}. ${sheet.background.description}`,
          '',
          'Build the town they are starting in.',
        ].join('\n'),
      },
    ],
  });

  const rawPlaces: Place[] = generated.region.places.map((p) => ({
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

  // Everything the code can decide, the code decides.
  const draftRegion: Region = {
    detail: 'full',
    id: 'floor-0',
    floor: 0,
    name: generated.region.name,
    biome: generated.region.biome,
    culture: generated.region.culture,
    danger: 0,
    places,
    entrance: generated.region.entrance,
    exit: generated.region.exit,
    // Ground level is a town: nothing hunts you here.
    creatures: [],
  };

  const repaired = repairRegion(draftRegion);

  const people: Record<string, Person> = {};
  for (const p of generated.people) {
    people[p.id] = {
      id: p.id,
      name: p.name,
      homeRegion: 'floor-0',
      trust: p.trust,
      oneLine: p.oneLine,
      tags: p.tags,
      alive: true,
      lastSeenTurn: 0,
      status: p.status === 'superior' || p.status === 'inferior' ? p.status : 'peer',
      // The model supplies the forms; the code decides which trust floors they
      // sit at, so the banding is consistent across every generated person.
      voice: repairVoice({
        selfPronoun: p.selfPronoun,
        underStress: p.underStress,
        addressBands: { '-3': p.addressDistant, '2': p.addressWarm },
        particleBands: { '-3': p.particleDistant, '2': p.particleWarm },
        tics: [],
      }).value,
      personality: clampPersonality({
        warmth: p.warmth, nerve: p.nerve, discipline: p.discipline,
        candour: p.candour, loyalty: p.loyalty,
      }),
      mental: restingMind(),
      counters: {},
      pressure: neutralPersonality(),
    };
  }

  // Drop references to people the generator never defined, rather than failing
  // the whole floor over a stray id.
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

  const repairs = [...repaired.repairs];
  if (dropped.length) repairs.push(`dropped undefined people: ${dropped.join(', ')}`);

  // "The way up has not been found yet" is legitimate on a deep floor, but on the
  // ground floor it means the player can never enter the tower. If repair had to
  // discard a bogus exit, adopt a real one.
  if (region.exit === null) {
    const candidate =
      region.places.find((p) => p.kind === 'gate' && p.id !== region.entrance) ??
      region.places.find((p) => p.id !== region.entrance);
    if (candidate) {
      region.exit = candidate.id;
      repairs.push(`ground floor had no way up; adopted "${candidate.id}" as the stair`);
    }
  }

  // The opening turn must have somebody in it. A generated town where everyone
  // stands somewhere the player is not gives a first impression of a dead world.
  const startPlace = chooseStartPlace(region);
  const start = region.places.find((p) => p.id === startPlace);
  const anyone = Object.keys(people)[0];
  if (start && start.people.length === 0 && anyone) {
    region.places = region.places.map((p) =>
      p.id === startPlace ? { ...p, people: [anyone] } : p,
    );
    repairs.push(`nobody was at the starting place "${startPlace}"; placed "${anyone}" there`);
  }

  // You have obviously discovered the place you are standing in. Travel marks
  // arrivals, but nothing marks the opening one — which left the first floor's
  // start counted among the world's secrets.
  region.places = region.places.map((p) => (p.id === startPlace ? { ...p, discovered: true } : p));

  // The model writes ids into the parts a player reads — affordances like
  // "climb stair_tower", descriptions naming warehouse_south. Rewrite them once,
  // here, where both the places and the people are known.
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
    throw new Error(`generated ground floor is unplayable: ${check.errors.map((e) => e.message).join('; ')}`);
  }

  return {
    region,
    people,
    premise: generated.premise,
    startPlace,
    repairs,
    warnings: check.warnings.map((w) => w.message),
  };
}

/* -------------------------------------------------------------------------- */
/* The whole of Session Zero                                                   */
/* -------------------------------------------------------------------------- */

export type GenesisResult = {
  sheet: CharacterSheet;
  world: World;
  premise: string;
  repairs: string[];
  warnings: string[];
};

export async function runGenesis(
  provider: Provider,
  interview: Interview,
  seed = Date.now(),
): Promise<GenesisResult> {
  const character = await generateCharacter(provider, interview);
  const ground = await generateGroundFloor(provider, interview, character.sheet);

  const world: World = {
    seed,
    language: interview.language,
    regions: { 'floor-0': ground.region },
    people: ground.people,
    facts: [],
    currentRegion: 'floor-0',
    currentPlace: ground.startPlace,
    deepestFloor: 0,
    turn: 0,
    flags: {},
  };

  return {
    sheet: character.sheet,
    world,
    premise: ground.premise,
    repairs: [...character.repairs, ...ground.repairs],
    warnings: [...character.warnings, ...ground.warnings],
  };
}
