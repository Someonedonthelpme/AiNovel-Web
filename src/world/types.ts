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
 * People outlive the places they came from. This registry is never compressed.
 */
export type Person = {
  id: PersonId;
  name: string;
  homeRegion: RegionId;
  /** Same scale as the combat-side relationship stat; drives Thai register. */
  trust: number;
  /** One line, so a long-forgotten NPC can still be written in voice. */
  oneLine: string;
  tags: string[];
  alive: boolean;
  lastSeenTurn: number;
};

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
};

export const regionIdFor = (floor: number): RegionId => `floor-${floor}`;

export const isFull = (r: RegionRecord): r is Region => r.detail === 'full';
export const isGazetteer = (r: RegionRecord): r is Gazetteer => r.detail === 'gazetteer';
