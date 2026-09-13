import { neutralTemperament, metNeeds } from '../character/persona.ts';
import type { NpcVoice, Person, Place, PlaceId, Region, World } from './types.ts';
import type { GeneratedFloor } from './floorgen.ts';

export function place(id: PlaceId, over: Partial<Place> = {}): Place {
  return {
    id,
    name: id,
    kind: 'landmark',
    description: '',
    connections: [],
    people: [],
    affordances: ['look around'],
    discovered: false,
    ...over,
  };
}

/** Add undirected edges, keeping both sides in step. */
export function link(places: Place[], edges: [PlaceId, PlaceId][]): Place[] {
  const byId = new Map(places.map((p) => [p.id, { ...p, connections: [...p.connections] }]));
  for (const [a, b] of edges) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) continue;
    if (!pa.connections.includes(b)) pa.connections.push(b);
    if (!pb.connections.includes(a)) pb.connections.push(a);
  }
  return [...byId.values()];
}

/** A plain polite Thai voice; override per person to differentiate them. */
export const defaultVoice = (): NpcVoice => ({
  selfPronoun: 'ดิฉัน',
  underStress: 'ฉัน',
  addressBands: { '-3': 'คุณ', '0': 'คุณ', '2': 'เธอ' },
  particleBands: { '-3': 'ค่ะ', '2': 'นะ' },
  tics: [],
});

export function person(id: string, over: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    homeRegion: 'floor-0',
    oneLine: 'a face in the crowd',
    tags: [],
    alive: true,
    lastSeenTurn: 0,
    voice: defaultVoice(),
    status: 'peer',
    temperament: neutralTemperament(),
    needs: metNeeds(),
    counters: {},
    pressure: neutralTemperament(),
    ...over,
  };
}

/** Ground level: a walled town with a gate below and a stair above. */
export function groundFloor(): Region {
  const places = link(
    [
      place('gate', { kind: 'gate', name: 'the low gate' }),
      place('town', { kind: 'settlement', name: 'Ashfall', people: ['smith', 'warden'] }),
      place('market', { name: 'the covered market', people: ['smith'] }),
      place('well', { name: 'the dry well' }),
      place('stair', { kind: 'gate', name: 'the first stair' }),
    ],
    [
      ['gate', 'town'],
      ['town', 'market'],
      ['town', 'well'],
      ['town', 'stair'],
    ],
  );

  return {
    detail: 'full',
    id: 'floor-0',
    floor: 0,
    name: 'Ashfall',
    biome: 'ash plain',
    culture: 'a guarded trading town beneath the tower',
    danger: 0,
    places,
    entrance: 'gate',
    exit: 'stair',
    creatures: [],
  };
}

/** A second floor, to exercise travel between regions. */
export function firstFloor(): Region {
  const places = link(
    [
      place('landing', { kind: 'gate', name: 'the landing' }),
      place('grove', { kind: 'wild', name: 'the grey grove' }),
      place('camp', { kind: 'settlement', name: "the poachers' camp", people: ['hunter'] }),
      place('rise', { kind: 'gate', name: 'the second stair' }),
    ],
    [
      ['landing', 'grove'],
      ['grove', 'camp'],
      ['grove', 'rise'],
    ],
  );

  return {
    detail: 'full',
    id: 'floor-1',
    floor: 1,
    name: 'The Grey Grove',
    biome: 'dead forest',
    culture: 'poachers and worse',
    danger: 1,
    places,
    entrance: 'landing',
    exit: 'rise',
    creatures: ['grey wolf'],
  };
}

export function world(over: Partial<World> = {}): World {
  const ground = groundFloor();
  return {
    seed: 1,
    language: 'en',
    regions: { 'floor-0': ground },
    people: {
      smith: person('smith', { name: 'Ora the smith', oneLine: 'sells iron, trusts no one' }),
      warden: person('warden', { name: 'Warden Bex', oneLine: 'keeps the gate, owes a debt' }),
      hunter: person('hunter', { name: 'Kell', homeRegion: 'floor-1', oneLine: 'knows the grove' }),
    },
    facts: [],
    currentRegion: 'floor-0',
    currentPlace: 'gate',
    deepestFloor: 0,
    turn: 0,
    flags: {},
    ...over,
  };
}

/** What the floor model returns for an ordinary three-place floor. */
export const generatedFloor = (over: Partial<GeneratedFloor> = {}): GeneratedFloor => ({
  bonds: [],
  name: 'The Grey Grove',
  biome: 'dead forest',
  culture: 'poachers and worse',
  places: [
    { id: 'landing', name: 'the landing', kind: 'gate', description: 'stone steps', connections: ['grove'], people: [], affordances: ['catch your breath'] },
    { id: 'grove', name: 'the grove', kind: 'wild', description: 'grey trees', connections: ['landing', 'rise'], people: ['kell'], affordances: ['search the undergrowth'] },
    { id: 'rise', name: 'the second stair', kind: 'gate', description: 'a spiral', connections: ['grove'], people: [], affordances: ['climb'] },
  ],
  entrance: 'landing',
  exit: 'rise',
  people: [{
    id: 'kell', name: 'Kell', oneLine: 'knows the grove', tags: ['poacher'], trust: 0, status: 'peer',
    selfPronoun: 'ข้า', underStress: 'กู',
    addressDistant: 'เจ้า', addressWarm: 'เอ็ง', particleDistant: 'วะ', particleWarm: 'นะ',
    intuition: 1, feeling: 2, nerve: 2, discipline: -1,
  }],
  creatures: ['หมาป่าเงา'],
  ...over,
});
