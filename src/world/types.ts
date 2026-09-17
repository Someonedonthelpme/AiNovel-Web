import type { Persona } from '../character/persona.ts';
export type { NpcVoice, Persona, Status } from '../character/persona.ts';
export { STATUSES } from '../character/persona.ts';
import type { CharacterSheet } from '../session/sheet.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Subject } from './subjects.ts';
import type { Edges } from '../social/edge.ts';
import type { Ambient } from '../social/ambient.ts';
import type { Populations } from '../character/population.ts';
import type { Role } from '../social/roles.ts';
import type { LootProfile } from '../items/catalogue.ts';
import type { Species } from '../character/species.ts';
/**
 * The world model.
 *
 * Every tower floor is a persistent REGION with its own biome, settlements and
 * people — not a disposable dungeon. That is expensive by default, so
 * persistence is tiered (see `lod.ts`): the active region is held in full
 * detail, visited regions compress to a gazetteer entry, and named people are
 * promoted out of the region into a global registry so relationships survive
 * compression. Places compress; people do not.
 *
 * The base town is simply floor 0 — there is no separate "hub" concept.
 */

export type RegionId = string;
export type PlaceId = string;
export type PersonId = string;
export type FactId = string;

export const PLACE_KINDS = ['settlement', 'wild', 'dungeon', 'landmark', 'gate'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export type Place = {
  id: PlaceId;
  name: string;
  kind: PlaceKind;
  description: string;
  /** Undirected edges; `linkPlaces` keeps both sides in step. */
  connections: PlaceId[];
  people: PersonId[];
  /**
   * What can actually be done here. The Director picks from this list rather
   * than inventing, which is what stops a location from drifting.
   */
  affordances: string[];
  discovered: boolean;
};

export type StratumId = string;

/**
 * A level above a floor: a tower, a dungeon inside it, an outer world.
 *
 * STRATA NEST — "four dungeons inside a twenty-floor tower" makes a dungeon a
 * sub-stratum, so the plan is a TREE and the innermost stratum containing a
 * floor is the one that speaks for it. A world need not declare any; the
 * ruleset dials answer for a world that does not.
 */
export type Stratum = {
  id: StratumId;
  name: string;
  /**
   * Whether this stratum may be generated twice.
   *
   * `static` is authored once by the model and then FROZEN — its floors are
   * never compressed and so never rehydrated, which is what makes coming back
   * the same place rather than a consistent retelling of it. `dynamic` is
   * today's behaviour: compressed when you leave, rebuilt from the gazetteer
   * when you return.
   */
  kind: 'static' | 'dynamic';
  /** The stratum this one sits inside. Absent for a root. */
  parent?: StratumId;
  /** The floors it covers, inclusive. `to` absent runs to the top. */
  from: number;
  to?: number;
  /** Its own danger curve. Absent inherits the parent's, then the ruleset's. */
  danger?: { base: number; perFloor: number };
  /**
   * What this stratum IS, in this world's own words.
   *
   * Authored once for the whole structure rather than per floor. Without it a
   * declared stratum is only a range: every floor invented its own biome and
   * culture, so four floors of one wing read as four unrelated places. The
   * model is told these and builds inside them; the floor stores them rather
   * than whatever it proposed instead.
   */
  theme?: {
    biome: string;
    culture: string;
    /** Who is found here — a phrase, not a roster. Fed to the people the floor generates. */
    people: string;
  };
  /**
   * What this place is known for dropping.
   *
   * A world's economy is REGIONAL: loot keyed on depth alone meant every floor
   * of every structure paid from one table, so no wing could be worth going to
   * for anything in particular. See `LootProfile`.
   */
  loot?: LootProfile;
};

/** A region held in full detail — the one you are standing in. */
export type Region = {
  detail: 'full';
  id: RegionId;
  floor: number;
  name: string;
  biome: string;
  culture: string;
  /** Scales with depth; drives encounter difficulty. */
  danger: number;
  places: Place[];
  /** Where you arrive from the floor below. */
  entrance: PlaceId;
  /** The way up. Null until the player finds it. */
  exit: PlaceId | null;
  /** What lives and hunts here. Names only; encounters take numbers from depth. */
  creatures: string[];
  /**
   * The ways out of this region, when they are not a stair.
   *
   * `floor` meant two things at once — how DEEP (danger, budgets, depth
   * experience, the ground law) and what CONNECTS to what (`crossTo(floor ± 1)`)
   * — and a structure that is not a stack is impossible while they are the same
   * number. Depth stays on `floor`; adjacency is this.
   *
   * Absent means the stack: up from `exit`, down from `entrance`, derived in
   * `linksFrom`. That is every world saved before this existed.
   */
  exits?: Link[];
  /**
   * The person who HOLDS this floor, on a landmark floor.
   *
   * On the region rather than a flag on the person, because holding is a fact
   * about the floor: it is what a fight here is against, and what 6c's ownership
   * will one day contest. The person lives in `World.people`, never compressed,
   * so a floor rebuilt from its gazetteer finds its holder again — dead or alive.
   */
  boss?: PersonId;
};

/**
 * One way out of a region.
 *
 * Carries the far side's DEPTH as well as its id, because the curves that
 * decide what is generated there — danger, budgets, what a fight is worth —
 * have to answer before the region on the other side exists.
 */
export type Link = {
  to: RegionId;
  /** The place you must be standing at to take it. */
  via: PlaceId;
  floor: number;
  /** Which way it goes, for a structure where that means anything. */
  direction?: 'up' | 'down';
};

/**
 * A region that has been visited and compressed. Geometry is gone; identity,
 * unfinished business and standing are kept.
 */
export type Gazetteer = {
  detail: 'gazetteer';
  id: RegionId;
  floor: number;
  name: string;
  biome: string;
  /** One paragraph. Enough to rehydrate consistently. */
  summary: string;
  /** People promoted to the global registry when this region compressed. */
  knownPeople: PersonId[];
  openThreads: string[];
  /** How this place regards the player. */
  reputation: number;
  compressedAtTurn: number;
};

export type RegionRecord = Region | Gazetteer;

/**
 * Trust runs across these bounds; the bands in NpcVoice key off it.
 *
 * Re-exported from `social/edge.ts`, where it is one range shared by every
 * relationship axis rather than a number that belongs to trust alone.
 */
export { EDGE_MIN as TRUST_MIN, EDGE_MAX as TRUST_MAX } from '../social/edge.ts';

/** How a companion is meant to behave. Whether they comply is another matter. */
export const STANCES = ['hold', 'press', 'protect', 'free'] as const;
export type Stance = (typeof STANCES)[number];

/**
 * People outlive the places they came from. This registry is never compressed.
 *
 * Everyone carries a persona — voice, standing, disposition, state of mind and
 * their own tally of what they have done. That is what makes talking to them
 * mean something, and it is cheap enough for a whole town.
 *
 * A full character SHEET is tiered: only people who can fight or travel with
 * you carry one, because abilities and hit dice are expensive to generate and
 * pointless for a face in a market.
 */
export type Person = Persona & {
  id: PersonId;
  name: string;
  homeRegion: RegionId;
  /** One line, so a long-forgotten NPC can still be written in voice. */
  oneLine: string;
  tags: string[];
  alive: boolean;
  lastSeenTurn: number;
  /** What they pursue off-screen. Optional: most people just live their lives. */
  agenda?: string[];
  agendaPace?: number;
  /** Present only for people who can fight or be recruited. */
  sheet?: CharacterSheet;
  recruited?: boolean;
  stance?: Stance;
};

/** Someone who can actually take the field. */
export const isCombatReady = (person: Person): boolean => Boolean(person.sheet);

/** An established truth about the world. Retrieved, never all included. */
export type Fact = {
  id: FactId;
  text: string;
  region: RegionId | null;
  people: PersonId[];
  establishedAtTurn: number;
};

export type World = {
  seed: number;
  language: 'th' | 'en';
  /**
   * What this world turns on, in its own words.
   *
   * Stored rather than derived because the model supplies the WORDS — the ids
   * and kinds still come from the seed. Absent means nobody has named them yet
   * and the fallback words stand.
   */
  subjects?: Subject[];
  /**
   * What people in this world can be to one another.
   *
   * Stored for the same reason `subjects` is: the SHAPES come from the seed,
   * but the words are the model's, and a word not stored is lost the next time
   * anything is derived. Absent means nobody has named them and the fallbacks
   * stand.
   */
  roles?: Role[];
  /**
   * The rules this world plays by. Absent means `STANDARD`.
   *
   * On the World because it is jsonb — it replays for free and needs no
   * migration — and because rules must be able to change mid-run, which
   * anything resolved at generation time could never do.
   */
  rules?: Ruleset;
  /**
   * The kinds of thing that live here.
   *
   * Stored for the same reason `subjects` and `roles` are: the shapes come from
   * the seed, and anything derived from a list that is not kept would differ
   * the next time it was derived. Absent means everybody is ordinary.
   */
  species?: Species[];
  /**
   * The structures this world holds, if it names any.
   *
   * A World HOLDS STRUCTURES; a tower is one kind. Absent means the whole world
   * is one unnamed stack, which is every world made before this existed.
   */
  strata?: Record<StratumId, Stratum>;
  regions: Record<RegionId, RegionRecord>;
  people: Record<PersonId, Person>;
  /**
   * Who feels what about whom, sparsely.
   *
   * On the World rather than on a Person because an edge belongs to neither
   * end of it — and because `Person.trust` living on the person is exactly why
   * the player could be regarded and never regard back. Absent means nobody
   * has met anybody yet.
   */
  edges?: Edges;
  /**
   * World time, in ticks, separate from `turn`: a play turn COVERS the time its
   * action takes, so a long crossing moves the clock further than a word does
   * (DESIGN 6b stage 7.1a). `turn` stays the play-turn count, because it seeds
   * every fight. Absent means a world stored before the clock; `clockOf` reads it.
   */
  clock?: number;
  journeys?: import('../play/journey.ts').Journey[];
  /** What this world calls its calendar. Absent means the fallback words (`calendarWords`). */
  calendar?: import('./calendar.ts').CalendarWords;
  /**
   * How each region regards the player.
   *
   * On the World rather than on a region because a region is not always a
   * region: it compresses to a gazetteer and is REBUILT by a model when you
   * come back, and standing you earned would not survive either. The gazetteer
   * keeps a copy for the rehydration brief — which is what finally gives
   * `Gazetteer.reputation` a writer, after a life of defaulting to nought.
   */
  reputation?: Record<RegionId, number>;
  /**
   * What is going around, per place.
   *
   * The cheap half of rumour: a place knows a thing to a degree, with no people
   * involved, and anybody standing there who does not know it themselves picks
   * it up. Keyed by place rather than region because the square hearing
   * something and the gate not yet is the whole point — see `ambient.ts`.
   */
  ambient?: Ambient;
  /**
   * Who lives where, per place.
   *
   * Keyed by place for the reason `ambient` is, and ABSENT until something has
   * been killed: a population answers from the seed until then, so this holds
   * only the thinning. See `character/population.ts`.
   */
  populations?: Populations;
  facts: Fact[];
  currentRegion: RegionId;
  currentPlace: PlaceId;
  deepestFloor: number;
  turn: number;
  /** Arbitrary switches the Director can set: doors opened, favours owed. */
  flags: Record<string, boolean>;
};

export const regionIdFor = (floor: number): RegionId => `floor-${floor}`;

export const isFull = (r: RegionRecord): r is Region => r.detail === 'full';
export const isGazetteer = (r: RegionRecord): r is Gazetteer => r.detail === 'gazetteer';
