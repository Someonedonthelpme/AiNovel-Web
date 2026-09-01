import type { Persona } from '../character/persona.ts';
export type { NpcVoice, Persona, Status } from '../character/persona.ts';
export { STATUSES } from '../character/persona.ts';
import type { CharacterSheet } from '../session/sheet.ts';
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

/** Trust runs across these bounds; the bands in NpcVoice key off it. */
export const TRUST_MIN = -3;
export const TRUST_MAX = 4;

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
  /** Read through the persona: warmth and stress shift the band actually used. */
  trust: number;
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
  regions: Record<RegionId, RegionRecord>;
  people: Record<PersonId, Person>;
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
