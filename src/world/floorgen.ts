import { openingEdges } from '../social/edge.ts';
import type { Edges } from '../social/edge.ts';
import { formRole, refFor, roleById, rolesOf } from '../social/roles.ts';
import type { Role } from '../social/roles.ts';

/**
 * Fold the model's proposed relationships in, dropping anything it invented.
 *
 * Shared by both generators, because both face the same two ways a bond can be
 * wrong: naming somebody who was never created, and naming a relationship this
 * world does not have. Neither is worth failing a floor over.
 */
export function bondsAmong(
  edges: Edges,
  roles: readonly Role[],
  people: Record<string, unknown>,
  bonds: readonly { a: string; b: string; role: string }[],
  repairs: string[],
): Edges {
  let next = edges;
  for (const bond of bonds) {
    if (!people[bond.a] || !people[bond.b]) {
      repairs.push(`dropped bond naming nobody: ${bond.a}/${bond.b}`);
      continue;
    }
    if (!roleById(roles, bond.role)) {
      repairs.push(`dropped bond with unknown relationship "${bond.role}"`);
      continue;
    }
    next = formRole(next, roles, bond.a, bond.b, refFor(bond.role, 'a'));
  }
  return next;
}
import type { Provider } from '../llm/provider.ts';
import { clampTemperament, neutralTemperament, metNeeds } from '../character/persona.ts';
import { repairRegion, repairVoice } from '../session/repair.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import { humanisePlaces, pruneDangling } from './naming.ts';
import { peopleBudget, placeBudget, settlementBudget } from './budget.ts';
import { rehydrationBrief } from './lod.ts';
import type { Gazetteer, Person, Place, PlaceKind, Region, RegionId, World } from './types.ts';
import { PLACE_KINDS, regionIdFor } from './types.ts';
import { validateRegion } from './validate.ts';
import { dangerAt, isLoop, lawFrom, stratumAt } from './strata.ts';
import type { Stratum } from './types.ts';
import { speciesIdFor } from '../character/species.ts';
import { bossMember, crowdFighter } from '../character/crowd.ts';
import { kindForFloor } from '../combat/encounter.ts';
import { mulberry32 } from '../engine/roll.ts';
import { LOOT_CATEGORIES } from '../items/catalogue.ts';
import type { LootCategory, LootProfile } from '../items/catalogue.ts';
import { rulesOf } from '../rules/ruleset.ts';

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
      /**
       * A WING this floor begins, if it begins one — a dungeon inside the
       * tower, a sunken quarter, a sealed ward. Empty name for the usual floor.
       *
       * Flat like the rest of this schema: the model names it and says roughly
       * how far it runs, and the engine decides where it hangs, how far it
       * really runs, and what it is called by.
       */
      wingName: str,
      wingFloors: { type: 'integer', minimum: 1, maximum: 6 },
      /** What the wing is KNOWN for finding, from a closed list. Empty for most. */
      wingKnownFor: { type: 'array', items: { type: 'string', enum: [...LOOT_CATEGORIES] }, maxItems: 2 },
      /** Who holds a landmark floor — a name and one line. Empty on every other floor. */
      bossName: str,
      bossOneLine: str,
      /** Who these people already are to each other. The template decides what that COSTS. */
      bonds: {
        type: 'array',
        maxItems: 4,
        items: obj({ a: str, b: str, role: str }, ['a', 'b', 'role']),
      },
    },
    ['name', 'biome', 'culture', 'places', 'entrance', 'exit', 'people', 'creatures', 'bonds', 'wingName', 'wingFloors', 'wingKnownFor', 'bossName', 'bossOneLine'],
  );
}

export type GeneratedFloor = {
  /** A wing this floor opens. Empty when it opens none, which is most floors. */
  wingName?: string;
  wingFloors?: number;
  wingKnownFor?: string[];
  /** A landmark floor's holder, in the model's words. Empty on every other floor. */
  bossName?: string;
  bossOneLine?: string;
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
  bonds: { a: string; b: string; role: string }[];
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
  /** A structure this floor begins, for the crossing to record and install. */
  stratum?: Stratum;
  /** The era band this floor gives its land to, being the first built in it (DESIGN 6c era E3b). */
  band?: Stratum;
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

function systemPrompt(floor: number, language: 'th' | 'en', settlements: { min: number; max: number }, danger: number, held: boolean): string {
  return [
    `You are building floor ${floor} of an endless tower, in ${LANGUAGE_NAME[language]}.`,
    styleRule(language),
    `This floor is a REGION with its own biome and character. Danger level ${danger}.`,
    'Deeper floors are stranger and more hostile than shallow ones.',
    'wingName is EMPTY on almost every floor. Name one only when this floor is',
    'plainly the mouth of somewhere else — a dungeon, a sunken quarter, a sealed',
    'ward — and say in wingFloors roughly how far it runs. Where it sits and how',
    'far it really runs are decided outside you. If it is known for finding',
    'something, name at most two kinds in wingKnownFor; otherwise leave it empty.',
    'One place is the arrival point from the floor below, and one is the way up;',
    'both have kind "gate", and they must be different places.',
    'Every connection must be listed on BOTH places it joins.',
    'Affordances are concrete things a player can do there, not descriptions.',
    settlements.max === 0
      ? 'This floor is wild: no settlement, and few or no people.'
      : `At most ${settlements.max} place(s) may have kind "settlement".`,
    'Every id in a place\'s people list must be an id in the people array.',
    '"creatures" names what lives and hunts here. Names only, no statistics.',
    held
      ? 'This is a LANDMARK floor: somebody holds it. bossName is what they are called and bossOneLine who they are, in one line. What they ARE, and how dangerous, is decided outside you.'
      : 'bossName and bossOneLine are EMPTY on this floor.',
    // Asked for `candour` and `loyalty` long after both were deleted, and never
    // for the two that replaced them. A model answering fields that are thrown
    // away is a model spending its attention on nothing.
    'Every person needs a temperament — how they are WIRED, not how they feel today — from -3 to +3:',
    '  intuition: literal and concrete (-3) to imaginative and abstract (+3)',
    '  feeling: coldly logical (-3) to led by what matters to them (+3)',
    '  nerve: easily frightened (-3) to fearless (+3)',
    '  discipline: impulsive (-3) to rigidly controlled (+3)',
    'Make them differ from each other. A floor of identical temperaments is a floor of nobody.',
    'underStress is what they call themselves when frightened or furious.',
    'In "bonds", say who these people already are to each other, using only the',
    'relationship ids you are given and ids from the people array. Two is plenty,',
    'and none is better than a pairing that makes no sense.',
  ].join('\n');
}

/** How a place greets somebody it remembers, in a phrase the model can write to. */
export function standingLine(reputation: number): string {
  if (reputation <= -6) return 'They know what you did here. Expect closed doors and worse.';
  if (reputation <= -2) return 'You are not welcome here, and people remember why.';
  if (reputation >= 6) return 'You are well thought of here, and it shows.';
  return 'People here have heard of you, and think reasonably well of it.';
}

function userPrompt(
  floor: number,
  world: World,
  sheet: CharacterSheet,
  gazetteer: Gazetteer | null,
  stratum: Stratum | null,
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
      // How the place remembers the climber. The reader that makes a
      // reputation felt rather than merely tallied: a floor that hates you
      // should be WRITTEN as a floor that hates you.
      gazetteer.reputation === 0 ? '' : standingLine(gazetteer.reputation),
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
    /*
     * A floor inside a structure belongs to it.
     *
     * "Make this floor feel unlike the one below it" is the right instruction
     * for an open climb and exactly the wrong one inside a wing meant to read
     * as one place — so the two are alternatives, never both.
     */
    stratum?.theme
      ? [
        `This floor is part of ${stratum.name}, and must feel of a piece with the rest of it.`,
        `Its biome is "${stratum.theme.biome}" and its people are ${stratum.theme.culture}.`,
        `Who is found here: ${stratum.theme.people}.`,
        'Vary what is IN it — the rooms, the trouble, who is standing where — never what it is.',
      ].join('\n')
      : 'Make this floor feel unlike the one below it.',
  ].filter(Boolean).join('\n');
}

export async function generateFloor(
  provider: Provider,
  world: World,
  floor: number,
  sheet: CharacterSheet,
  gazetteer: Gazetteer | null = null,
  /**
   * WHERE this is being built, when it is not simply a floor.
   *
   * `regionIdFor(floor)` was the only source of a region id, which made every
   * world a stack by construction: two places at one depth could not both
   * exist. Depth still decides how dangerous and how large; the id decides
   * where it hangs in the world.
   */
  into: RegionId = regionIdFor(floor),
): Promise<FloorResult> {
  // Floor 0 is AUTHORED at world creation, never generated — this guard exists
  // to stop a crossing overwriting the town. It used to read `floor < 1`, a
  // third copy of "the ground is the bottom" hiding in the generator: with the
  // law lifted, `descend` asks for floor -1 and got a throw instead of a floor.
  // Whether anyone may go there is the LAW's question, answered in `travel.ts`.
  // How far down there is to go is `world.depthBelowGround`, checked by
  // `descend` before anything is ever asked of a generator.
  // The invariant is the authored GROUND, which is a region id — not depth 0.
  // Keyed on the id because an outer world sits at depth 0 perfectly legally,
  // and a region there is only forbidden when it would overwrite the town.
  if (into === regionIdFor(0)) throw new Error('floor 0 is the authored ground, not generated');

  // The stratum first, then this world's dials. `dangerFor(floor)` was called
  // bare here, so neither ever reached a generated floor.
  const danger = dangerAt(world, floor);
  // The structure this floor belongs to, if any. Its character is authored once
  // for the whole wing rather than reinvented per floor.
  const stratum = stratumAt(world, floor);

  const canon = gazetteer
    ? rehydrationBrief(world, gazetteer)
    : { people: [], facts: [] as string[] };

  const generated = await provider.structured<GeneratedFloor>({
    schemaName: `floor_${floor}`,
    schema: floorSchema(floor),
    temperature: 0.9,
    messages: [
      { role: 'system', content: systemPrompt(floor, world.language, settlementBudget(floor), danger, isHeld(world, floor)) },
      {
        role: 'user',
        content: userPrompt(floor, world, sheet, gazetteer, stratum, {
          people: 'people' in canon ? canon.people.map((p) => `${p.id} "${p.name}": ${p.oneLine}`) : [],
          facts: canon.facts,
        }),
      },
    ],
  });

  const regionId = into;
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
    // Established canon first, then the structure's own character, then what
    // the model proposed — a returning floor keeps what it was, and a floor in
    // a wing is the wing's.
    biome: gazetteer?.biome ?? stratum?.theme?.biome ?? generated.biome,
    culture: stratum?.theme?.culture ?? generated.culture,
    danger,
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
      // The same seeded draw the ground town uses, so who is what does not
      // depend on which floor somebody happened to be generated on.
      species: speciesIdFor(world.seed, p.id, world.species ?? []),
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

  /*
   * A LANDMARK FLOOR IS HELD BY SOMEBODY, made here before anyone meets them, so
   * they can be heard about first and so the fight on this floor is against a
   * person rather than a statblock. The model supplies the name; the engine
   * supplies everything that matters.
   */
  const holder = holderOf(world, floor, regionId, generated, danger);
  if (holder) people[holder.id] = holder;

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

  if (holder) region.boss = holder.id;

  const check = validateRegion(region, people);
  if (!check.ok) {
    throw new Error(`generated floor ${floor} is unplayable: ${check.errors.map((e) => e.message).join('; ')}`);
  }

  const wing = wingOf(generated, floor, region, stratum, world);
  const band = bandLandOf(world, floor, region);
  return {
    region,
    people,
    edges: bondsAmong(openingEdges({}, arrivals), rolesOf(world), people, generated.bonds ?? [], repairs),
    creatures: generated.creatures,
    ...(wing ? { stratum: wing } : {}),
    ...(band ? { band } : {}),
    repairs,
    warnings: check.warnings.map((w) => w.message),
  };
}

/**
 * An era band is one land in different times, so the FIRST floor built in it
 * gives the band its land, as a wing takes its character from the floor that
 * opened it. Set once: a band that already has a theme keeps it.
 */
function bandLandOf(world: World, floor: number, region: Region): Stratum | undefined {
  const band = lawFrom(world, floor, 'time');
  if (band?.laws?.time !== 'era' || band.theme) return undefined;
  return { ...band, theme: { biome: region.biome, culture: region.culture, people: region.culture } };
}

/**
 * The wing this floor opens, if the model said it opens one.
 *
 * The engine decides everything that could break the tree: it hangs inside
 * whatever this floor was already in, starts HERE, runs a bounded number of
 * floors, and takes its character from the floor that opened it — so a wing can
 * never be authored somewhere the player is not, or run to the top of the
 * world. Frozen, because a named wing that rewrites itself behind you is
 * indistinguishable from ordinary floors.
 */
function wingOf(
  generated: GeneratedFloor, floor: number, region: Region, parent: Stratum | null, world: World,
): Stratum | undefined {
  const name = (generated.wingName ?? '').trim();
  if (!name || EMPTY_WING.has(name.toLowerCase())) return undefined;

  const floors = Math.max(1, Math.min(6, Math.round(generated.wingFloors ?? 1)));
  const id = `wing-${floor}`;
  const loot = lootKnownFor(generated.wingKnownFor ?? []);
  return {
    id,
    name,
    kind: 'static',
    ...(parent ? { parent: parent.id } : {}),
    from: floor,
    to: floor + floors - 1,
    danger: wingDanger(world, floor, parent, id),
    theme: { biome: region.biome, culture: region.culture, people: region.culture },
    ...(loot ? { loot } : {}),
  };
}

/**
 * A wing's danger curve: where it opens, nudged by the seed.
 *
 * A number, so the SEED decides it and never the model. The swing (−2..+3) is
 * keyed on the world and the wing's id, so a replay draws the same curve, and it
 * lands on the danger at the floor the wing opens — a wing is a harder or a
 * quieter pocket of where you already are, not a jump to somewhere else. The
 * slope is whatever the floor already climbs at.
 */
function wingDanger(world: World, floor: number, parent: Stratum | null, id: string): { base: number; perFloor: number } {
  let hash = (world.seed ^ 0x3a9e) >>> 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  const swing = Math.floor(mulberry32(hash)() * 6) - 2;

  const perFloor = parent?.danger?.perFloor ?? rulesOf(world).world.dangerPerFloor;
  return { base: dangerAt(world, floor) + swing - floor * perFloor, perFloor };
}

/**
 * What a wing is known for, as weights on the ordinary table.
 *
 * The model NAMES categories from `LOOT_CATEGORIES`; anything else is dropped,
 * and naming nothing leaves the ordinary table untouched. What it named is three
 * times as likely, everything else half as likely — so a wing known for blades
 * is somewhere you go FOR blades, and pays thinner in the rest.
 */
function lootKnownFor(named: readonly string[]): LootProfile | undefined {
  const known = [...new Set(named)].filter((c): c is LootCategory => (LOOT_CATEGORIES as readonly string[]).includes(c)).slice(0, 2);
  if (known.length === 0) return undefined;
  return { weights: Object.fromEntries(LOOT_CATEGORIES.map((c) => [c, known.includes(c) ? 3 : 0.5])) };
}

/**
 * Whether a floor is HELD: every tenth floor is a landmark, and every floor of a
 * loop is held too (DESIGN 6c, loop L2b) — a loop floor is cleared by its holder's
 * death, so one with nobody holding it would never loop.
 */
const isHeld = (world: World, floor: number): boolean => kindForFloor(floor) === 'boss' || isLoop(world, floor);

/** What a model writes when it means "this floor opens nothing". */
const EMPTY_WING = new Set(['', 'none', 'null', 'n/a', '-', 'ไม่มี']);

/**
 * The person who holds a landmark floor, or null when there is none to make.
 *
 * None on an ordinary floor whatever the model wrote, none in a world with no
 * kinds (it keeps the crowd boss it always had), and none if the model named
 * nobody — the engine invents no words. A holder who already exists is RETURNED,
 * not remade: people are never compressed, so coming back to a rebuilt floor
 * finds the same one, and a dead boss stays dead.
 */
function holderOf(world: World, floor: number, regionId: RegionId, generated: GeneratedFloor, danger: number): Person | null {
  if (!isHeld(world, floor)) return null;
  const kinds = world.species ?? [];
  if (kinds.length === 0) return null;

  const id = `boss-${regionId}`;
  if (world.people[id]) return world.people[id];

  const who = bossMember(world.seed, kinds, floor);
  if (!who) return null;
  /*
   * A LOOP floor with nobody named is still held, by the lineage's own word: a
   * loop floor without a holder has nothing to clear and would silently never
   * loop. A landmark keeps the old rule — nobody named, nobody made.
   *
   * `ponytail: the floor's own creature word for the lineage would read better,
   * but that mapping (`foeSpecies`) lives in play, which world may not import.
   * Move it down into character if the lineage's word reads wrong in play.`
   */
  const name = generated.bossName?.trim()
    || (isLoop(world, floor) ? kinds.find((k) => k.id === who.subspecies)?.name : undefined);
  if (!name) return null;

  const { sheet } = crowdFighter(world.seed, kinds, who, danger, id);
  return {
    id,
    name,
    homeRegion: regionId,
    oneLine: generated.bossOneLine?.trim() || name,
    tags: [],
    species: who.subspecies,
    alive: true,
    lastSeenTurn: world.turn,
    status: 'superior',
    voice: repairVoice({ selfPronoun: '', underStress: '', addressBands: {}, particleBands: {}, tics: [] }).value,
    temperament: neutralTemperament(),
    needs: metNeeds(),
    counters: {},
    pressure: neutralTemperament(),
    sheet: { ...sheet, name },
  };
}
