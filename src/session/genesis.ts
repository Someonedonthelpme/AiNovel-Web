import type { Attack } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import { subjectsFor } from '../world/subjects.ts';
import { nameSubjects } from '../world/subjectnames.ts';
import type { Subject } from '../world/subjects.ts';
import type { Drive } from '../character/persona.ts';
import { openingEdges, PLAYER } from '../social/edge.ts';
import { rolesFor } from '../social/roles.ts';
import { bondsAmong } from '../world/floorgen.ts';
import { nameRoles } from '../social/rolenames.ts';
import { nameCalendar } from '../world/calendar.ts';
import type { Role } from '../social/roles.ts';
import type { Edges } from '../social/edge.ts';
import type { Provider } from '../llm/provider.ts';
import { keepsake, stripMechanics } from '../items/catalogue.ts';
import { classOf } from '../character/classes.ts';
import { humanisePlaces, pruneDangling } from '../world/naming.ts';
import type { Person, Place, PlaceKind, Region, World } from '../world/types.ts';
import { PLACE_KINDS } from '../world/types.ts';
import { validateRegion } from '../world/validate.ts';
import type { Interview } from './interview.ts';
import { isComplete, transcript } from './interview.ts';
import { clampTemperament, neutralTemperament, metNeeds } from '../character/persona.ts';
import { repairAbilities, repairRegion, repairVoice } from './repair.ts';
import type { GeneratedCharacter, GeneratedGroundFloor } from './schema.ts';
import { CHARACTER_SCHEMA, GROUND_FLOOR_SCHEMA } from './schema.ts';
import type { Background, CharacterSheet, Skill } from './sheet.ts';
import { POINT_BUY_BUDGET, POINT_BUY_MAX, POINT_BUY_MIN, validateSheet } from './sheet.ts';
import { sword } from '../combat/fixtures.ts';
import { presetNamed } from '../rules/ruleset.ts';
import type { PresetName } from '../rules/ruleset.ts';
import type { Stratum } from '../world/types.ts';
import { dominantOf, FOLK, leavesOf, speciesFor, speciesIdFor } from '../character/species.ts';
import { nameSpecies } from '../character/speciesnames.ts';
import { signatureSkill } from '../character/speciesskill.ts';
import { withKin } from '../character/kinship.ts';
import type { Species, SpeciesChoice } from '../character/species.ts';

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


const asAbility = (v: string) =>
  (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).includes(v as never) ? (v as Skill['ability']) : 'str';

export type CharacterGenesis = {
  sheet: CharacterSheet;
  repairs: string[];
  warnings: string[];
  /** The kind the model mapped the player's words onto, when asked. Unchecked. */
  speciesSaid?: string;
};

/**
 * A model writes on the narrow scale; temperament is stored on the wide one.
 *
 * Asking for −10..+10 gets you a wall of 7s and −4s that mean nothing. Asking
 * for −3..+3 gets you a judgement, which is the only part a model is good at.
 * The width exists for drift and the skill formulas, not for the author.
 */
const scaleToStored = (narrow: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [axis, value] of Object.entries(narrow ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) out[axis] = value * 3;
  }
  return out;
};

/**
 * A drive, mapped from what the model chose to what the world actually has.
 *
 * Indices are clamped rather than trusted, and a want that came back equal to
 * the fear is nudged — a character running from the very thing they are
 * climbing for is a coherent idea, but not one a model picks on purpose.
 *
 * Falls back to a seeded pick, so a drive exists even when the model returns
 * nothing usable. A character with no WHY is worse than one with a guessed WHY.
 */
export function driveFrom(
  chosen: { want?: number; fear?: number } | undefined,
  subjects: readonly Subject[],
  seed: number,
): Drive {
  if (subjects.length === 0) return { want: '', fear: '' };
  const at = (n: number | undefined, fallback: number) =>
    Number.isInteger(n) && n! >= 0 && n! < subjects.length ? n! : fallback;

  const rng = mulberry32((seed ^ 0xd21e) >>> 0);
  const wantAt = at(chosen?.want, Math.floor(rng() * subjects.length));
  let fearAt = at(chosen?.fear, Math.floor(rng() * subjects.length));
  if (fearAt === wantAt) fearAt = (wantAt + 1) % subjects.length;

  return { want: subjects[wantAt].id, fear: subjects[fearAt].id };
}

export async function generateCharacter(
  provider: Provider,
  interview: Interview,
  seed = 0,
  named?: readonly Subject[],
  /** The player's own words for what KIND of being they are, and the kinds to map them onto. */
  described?: { words: string; kinds: readonly Species[] },
): Promise<CharacterGenesis> {
  if (!isComplete(interview)) throw new Error('the interview is not finished');

  const { language, draft } = interview;
  // The world's subjects, named if naming has run. Ids and kinds come from the
  // seed either way, so the drive matches the same things regardless.
  const subjects = named ?? subjectsFor(seed);
  const held = classOf(draft);
  const pinned = [
    draft.name ? `The character is named "${draft.name}".` : '',
    draft.backgroundName ? `Their background must be "${draft.backgroundName}".` : '',
    // Naming the class makes the generated prose READ like one, while the
    // numbers still come from code.
    held ? `They are a ${held.name.en}: ${held.description.en} Write them as one.` : '',
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
          // Read from the constant, not written out. The budget moved from 27
          // to 40 when the stats went from six to nine, and a prompt saying
          // otherwise would have the model quietly building illegal sheets.
          `Ability scores use point buy: each score ${POINT_BUY_MIN}-${POINT_BUY_MAX}, costing 0,1,2,3,4,5,7,9 respectively, ${POINT_BUY_BUDGET} points total.`,
          'There are NINE scores. con is the mind holding on and grants no hit points; vit is the body and grants them all.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Session Zero interview:',
          '',
          transcript(interview),
          '',
          'The subjects this world turns on. "drive" picks two of these BY NUMBER:',
          ...subjects.map((subject, at) => `  ${at}. ${subject.name} (${subject.kind})`),
          ...(pinned.length ? ['', 'Fixed by the player, do not contradict:', ...pinned] : []),
          ...(described
            ? [
              '',
              `The player describes what KIND of being they are: "${described.words}".`,
              'Set "species" to the id of the closest of these kinds, and to nothing else:',
              ...described.kinds.map((k) => `  ${k.id}: ${k.name}`),
            ]
            : []),
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
    })),
    // Flavour from the model, mechanics from the code: see `keepsake`.
    startingGear: generated.background.startingGear.map((g) => keepsake(g.id, g.name, stripMechanics(g.description))),
    // What they set out holding: the class's own weapon, or whatever the model
    // proposed when no class was chosen.
    startingAttacks: held
      ? [held.startingAttack]
      : (generated.background.startingAttacks as Attack[]).length
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
    classId: held?.id,
    // Carried onto the sheet, not just its id. A generated class is in no
    // global list, so the id alone would resolve to nothing the moment this
    // world's roster was regenerated with a different generator.
    classSpec: draft.classSpec,
    // The class decides the die. Asking a model to pick one meant a scholar
    // could roll d12 and a barbarian d6, and nothing downstream could tell.
    hitDie: held ? held.hitDie : [6, 8, 10, 12].includes(generated.hitDie) ? generated.hitDie : 8,
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
    temperament: clampTemperament(scaleToStored(generated.personality)),
    drive: driveFrom(generated.drive, subjects, seed),
    needs: metNeeds(),
    counters: {},
    pressure: neutralTemperament(),
  };

  const check = validateSheet(sheet);
  if (!check.ok) throw new Error(`generated character is invalid: ${check.errors.join('; ')}`);

  return {
    sheet,
    repairs: abilities.repairs,
    warnings: check.warnings,
    ...(described && generated.species ? { speciesSaid: generated.species } : {}),
  };
}

/**
 * The climber's kind, from how the player chose it.
 *
 * Never a kind the world lacks: a pick or a mapping that names one falls back to
 * the ordinary kind, with a warning, rather than inventing a creature the drift
 * rules have no numbers for.
 */
function climberSpecies(
  choice: SpeciesChoice | undefined, said: string | undefined, seed: number, kinds: readonly Species[], warnings: string[],
): string | undefined {
  if (!choice) return undefined;
  if ('decide' in choice) return speciesIdFor(seed, PLAYER, kinds);
  const asked = 'pick' in choice ? choice.pick : said;
  // A climber is a SUBSPECIES, like everything else alive: a type or a group is
  // a category, not a body, so picking one is picking nothing in particular.
  if (leavesOf(kinds).some((k) => k.id === asked)) return asked;
  const ordinary = ordinaryOf(seed, kinds);
  warnings.push(`species "${asked ?? ''}" is not a kind this world holds; the climber is ${ordinary}`);
  return ordinary;
}

/**
 * The kind a climber is when nobody chose one: this world's dominant kind.
 *
 * What "ordinary" meant when it was `folk`, except that it is now one of this
 * world's own peoples. Nobody is left WITHOUT a kind: a climber with no species
 * was a creature the drift rules had no numbers for, which is the hole
 * `speciesTemplate` and this both close.
 */
const ordinaryOf = dominantOf;

/* -------------------------------------------------------------------------- */
/* Ground floor                                                                */
/* -------------------------------------------------------------------------- */

const asPlaceKind = (v: string): PlaceKind =>
  (PLACE_KINDS as readonly string[]).includes(v) ? (v as PlaceKind) : 'landmark';

export type WorldGenesis = {
  region: Region;
  people: Record<string, Person>;
  /** What the opening cast already thinks of the player. */
  edges: Edges;
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
  roles: readonly Role[] = [],
  seed = 0,
): Promise<WorldGenesis> {
  const { language } = interview;
  // Recomputed from the seed rather than threaded down, the same way traits and
  // Signets are looked up wherever they are needed: it is a pure function of a
  // number, so two callers cannot disagree about what this world holds.
  const kinds = speciesFor(seed);

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
          // The prompt had gone stale against its own schema: it asked for
          // warmth, candour and loyalty, none of which are stored any more, and
          // never mentioned intuition or feeling, which are.
          'Every person needs a temperament — how they are WIRED, not how they feel today — from -3 to +3:',
          '  intuition: concrete and literal (-3) to abstract and associative (+3)',
          '  feeling: decides by logic (-3) to decides by values (+3)',
          '  nerve: easily frightened (-3) to fearless (+3)',
          '  discipline: impulsive (-3) to rigidly controlled (+3)',
          'Make them differ from each other. A town of identical temperaments is a town of nobody.',
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
          'Relationships available in this world:',
          ...roles.map((r) => `  ${r.id}: a="${r.names[0]}", b="${r.names[1]}"`),
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
      oneLine: p.oneLine,
      tags: p.tags,
      // Seeded from the world and their id, so a replay makes the same person
      // the same kind of thing without storing anything extra to do it.
      species: speciesIdFor(seed, p.id, kinds),
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
      temperament: clampTemperament({
        intuition: p.intuition * 3, feeling: p.feeling * 3,
        nerve: p.nerve * 3, discipline: p.discipline * 3,
      }),
      needs: metNeeds(),
      counters: {},
      pressure: neutralTemperament(),
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

  /*
   * The bonds, applied last — after the cast is settled, so a bond naming
   * somebody the generator never created is dropped rather than minting an
   * edge to a person who does not exist.
   *
   * The model chose the pair and the relationship; the template decided what
   * that relationship obliges, allows and opens the axes at. Both directions
   * are written at once, because half a relationship reads as a bug.
   */
  /*
   * And what each of them makes of the climber's KIND before a word is said.
   *
   * Applied under the model's own opening trust rather than over it: kinship is
   * where a stranger starts from, and what the generator said about this person in
   * particular is worth more than what their sort would say.
   */
  const withKinship = withKin(openingEdges({}, generated.people), kinds, sheet.species, Object.values(people));
  const edges = bondsAmong(withKinship, roles, people, generated.bonds ?? [], repairs);

  return {
    region,
    people,
    // What each of them already thinks of you, as an edge rather than a field
    // on the person — a relationship belongs to neither end of it.
    edges,
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

/** What the structure every world starts with is called, before anyone renames it. */
const TOWER_NAME = { en: 'the tower', th: 'หอคอย' } as const;

/**
 * A LOOP band (DESIGN 6c, loop L2a): floors 1–10, each put back as it was built
 * whenever it is left uncleared. The engine's words for it, like the tower's, and
 * the tower's kind, because the innermost stratum speaks for a floor — a band that
 * said `dynamic` would quietly unfreeze ten floors of a frozen tower.
 */
const LOOP_NAME = { en: 'the loop', th: 'วงวน' } as const;
const loopBandIn = (language: 'en' | 'th', kind: Stratum['kind']): Stratum =>
  ({ id: 'loop', name: LOOP_NAME[language], kind, parent: 'tower', from: 1, to: 10, laws: { reset: 'untilCleared' } });

/**
 * An ERA band (DESIGN 6c, era E2): floors 21–30, each its own year (`eraOf`).
 * The tower's kind for the same reason as the loop band's, and always a top
 * floor, because eras count down from it.
 */
const ERA_NAME = { en: 'the eras', th: 'ยุคสมัย' } as const;
const eraBandIn = (language: 'en' | 'th', kind: Stratum['kind']): Stratum =>
  ({ id: 'era', name: ERA_NAME[language], kind, parent: 'tower', from: 21, to: 30, laws: { time: 'era' } });

export async function runGenesis(
  provider: Provider,
  interview: Interview,
  seed = Date.now(),
  rules: PresetName = 'standard',
  /**
   * Whether the tower is authored once and frozen, or rebuilt as you return.
   *
   * A creation choice rather than a constant: "a twenty-floor static tower" is
   * one of the worlds the design asks to be reachable, and a frozen world is
   * also the cheap one — a floor you come back to costs no model call at all.
   */
  structure: Stratum['kind'] = 'dynamic',
  /** How the climber's kind is chosen. Absent: the ordinary kind. */
  species?: SpeciesChoice,
  /** Whether floors 1–10 are born a LOOP band (DESIGN 6c, loop L2a). */
  loopBand = false,
  /** Whether floors 21–30 are born an ERA band (DESIGN 6c, era E2). */
  eraBand = false,
): Promise<GenesisResult> {
  /*
   * Named FIRST, because the character call lists them and asks which two this
   * person is climbing for and away from. Fallback words are setting-neutral
   * by design, so an unnamed world offers "the long quarrel" where a drowned
   * coast should offer "the flood" — and the drive is only as evocative as the
   * palette it chose from.
   */
  const subjects = await nameSubjects(
    provider, subjectsFor(seed), interview.answers.world ?? '', interview.language,
  );

  /*
   * The kinds get their words BEFORE the character call, because that call maps
   * the player's own description of what they are onto one of them — and it can
   * only do that well if they are called something.
   */
  const kinds = await nameSpecies(provider, speciesFor(seed), interview.answers.world ?? '', interview.language);
  const character = await generateCharacter(
    provider, interview, seed, subjects,
    species && 'describe' in species ? { words: species.describe, kinds } : undefined,
  );
  const warnings: string[] = [];
  const kind = climberSpecies(species, character.speciesSaid, seed, kinds, warnings);
  // No choice is the ordinary kind — which has a body too, or two ordinary
  // climbers would differ by whether anyone asked.
  const born = kind ?? ordinaryOf(seed, kinds);
  const mine = kinds.find((k) => k.id === born);
  /*
   * And what their kind can DO, on the sheet beside what a book would teach.
   *
   * `learned` rather than a new field: a species skill is used exactly like any
   * other active, and `activeSkills` already reads that list — a second list
   * would mean every reader asking twice.
   */
  const signature = mine ? signatureSkill(seed, mine) : null;
  const sheet = {
    ...character.sheet,
    species: born,
    speciesTemplate: mine?.template,
    ...(signature ? { learned: [...(character.sheet.learned ?? []), signature] } : {}),
  };

  /*
   * And the roles, for the same reason: the ground floor is asked who its
   * people already are to each other, and it can only answer in words this
   * world has. The shapes come from the seed; only the nouns are asked for.
   */
  const roles = await nameRoles(
    provider, rolesFor(seed), interview.answers.world ?? '', interview.language,
  );

  const ground = await generateGroundFloor(provider, interview, sheet, roles, seed);

  // The calendar's words (7.1e). Asked LAST, and the game does without them.
  const calendar = await nameCalendar(provider, interview.answers.world ?? '', interview.language);

  const world: World = {
    seed,
    language: interview.language,
    subjects,
    roles,
    calendar,
    /*
     * The world keeps the ruleset it was BORN under, in full.
     *
     * `World.rules` had no writer until here, so every world ever created
     * played by STANDARD and the presets were reachable only from tests. Stored
     * whole rather than by name because retuning a preset must not reach back
     * into a run already under way — the same reason a climb is a recorded
     * event rather than something recomputed on load.
     */
    /** The kinds of thing that live here. Pure in the seed; see `species.ts`. */
    species: kinds,
    rules: presetNamed(rules),
    /*
     * A WORLD HOLDS STRUCTURES; a tower is one kind, and this is the one every
     * world starts with. It covers floor 0 because the ground town is part of
     * the tower rather than a hub beside it — the same claim `regionIdFor(0)`
     * has always made. Sub-strata (a dungeon inside it) nest under this id.
     */
    strata: {
      tower: { id: 'tower', name: TOWER_NAME[interview.language], kind: structure, from: 0 },
      ...(loopBand ? { loop: loopBandIn(interview.language, structure) } : {}),
      ...(eraBand ? { era: eraBandIn(interview.language, structure) } : {}),
    },
    regions: { 'floor-0': ground.region },
    people: ground.people,
    edges: ground.edges,
    facts: [],
    currentRegion: 'floor-0',
    currentPlace: ground.startPlace,
    deepestFloor: 0,
    turn: 0,
    flags: {},
  };

  return {
    sheet,
    world,
    premise: ground.premise,
    repairs: [...character.repairs, ...ground.repairs],
    warnings: [...character.warnings, ...warnings, ...ground.warnings],
  };
}
