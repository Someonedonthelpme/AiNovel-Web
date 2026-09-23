import { mulberry32 } from '../engine/roll.ts';
import { linkMinutes, pairDraw, terrainFactor } from './travel.ts';
import { CAPS, tierOf } from './settlement.ts';
import { isFull, regionIdFor } from './types.ts';
import type { PlaceId, PlaceKind, Region, RegionId, World } from './types.ts';

/**
 * Walkable maps (DESIGN 6c §2, W2).
 *
 * A place is a HUB map; each link between two places is a FIELD map between
 * their portals. A tile is 1.5 m, the combat grid's square, and walking moves
 * eight ways like combat does. Tiles are `.` open (a second to enter), `,` rough
 * (two) and `#` wall. Drawn from the seed alone, and stored on first entry
 * (`db/maps.ts`) so a later change here never moves a map a session has seen.
 *
 * PORTALS are not stored. They are read off the place graph every time, each at
 * a spot dealt from the seed, the place and where it leads — so a way revealed
 * after a hub was stored still gets its door, and no other door moves.
 */

export type Cell = { x: number; y: number };
export type MapId = string;
/** `ends` is a field's two portals, in id order of the places they lead to. */
export type GameMap = { id: MapId; kind: 'hub' | 'field'; rows: string[]; ends?: [Cell, Cell] };
export type Portal = (Cell & { to: MapId }) | (Cell & { region: RegionId });

export const hubId = (region: RegionId, place: PlaceId): MapId => `hub:${region}:${place}`;
/** The same field from either end. */
export const fieldId = (region: RegionId, a: PlaceId, b: PlaceId): MapId =>
  `field:${region}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;

type Parsed = { kind: 'hub'; region: RegionId; place: PlaceId } | { kind: 'field'; region: RegionId; lo: PlaceId; hi: PlaceId };

function parse(id: MapId): Parsed {
  const kind = id.slice(0, id.indexOf(':'));
  const rest = id.slice(kind.length + 1);
  const region = rest.slice(0, rest.indexOf(':'));
  const tail = rest.slice(region.length + 1);
  if (kind === 'hub' && region) return { kind, region, place: tail };
  const bar = tail.indexOf('|');
  if (kind === 'field' && region && bar > 0) return { kind, region, lo: tail.slice(0, bar), hi: tail.slice(bar + 1) };
  throw new Error(`not a map id: "${id}"`);
}

function regionOf(world: World, id: RegionId, map: MapId): Region {
  const region = world.regions[id];
  if (!region || !isFull(region)) throw new Error(`map "${map}": region "${id}" is not loaded in full`);
  return region;
}

/** Where the player stands: `world.at`, or the centre of the current place's hub. */
export function positionOf(world: World): { map: MapId; x: number; y: number } {
  if (world.at) return world.at;
  const region = regionOf(world, world.currentRegion, hubId(world.currentRegion, world.currentPlace));
  const kind = region.places.find((p) => p.id === world.currentPlace)?.kind ?? 'landmark';
  const tier = tierOf(world, region.id, world.currentPlace);
  // A hub is 2r+3 square about its centre (`drawHub`).
  const r = tier ? CAPS[tier].radius : HUB_RADIUS[kind];
  return { map: hubId(region.id, world.currentPlace), x: r + 1, y: r + 1 };
}

/**
 * The world with no position on a map, so you stand at the centre of your place.
 * The key is REMOVED, not set to undefined: a snapshot is JSON and drops it, and
 * the fold must equal the snapshot exactly (invariant 1).
 */
export function unplaced(world: World): World {
  const { at: _, ...rest } = world;
  return rest;
}

/** Seconds to step onto a tile; Infinity for a wall. */
export const tileSeconds = (m: GameMap, c: Cell): number => COST[m.rows[c.y]?.[c.x]] ?? Infinity;

/** Whether a map id names a field, and if so the two places it joins. */
export function fieldEnds(id: MapId): [PlaceId, PlaceId] | null {
  const at = parse(id);
  return at.kind === 'field' ? [at.lo, at.hi] : null;
}

/** Draw a map from the seed. Throws on a place or link the region does not have. */
export function drawMap(world: World, id: MapId): GameMap {
  const at = parse(id);
  const region = regionOf(world, at.region, id);
  if (at.kind === 'hub') {
    const place = region.places.find((p) => p.id === at.place);
    if (!place) throw new Error(`map "${id}": no place "${at.place}" in ${region.id}`);
    return drawHub(world, region, place.id, place.kind);
  }
  return drawField(world, region, at.lo, at.hi);
}

// ─── pathfinding ────────────────────────────────────────────────────────────

const COST: Record<string, number> = { '.': 1, ',': 2 };
/** Seconds are the key; rough tiles crossed break ties, so a best path keeps to open ground where it can. */
const TIE = 8192;

/** Cheapest path, eight ways, charging each tile ENTERED. Null when there is none. */
function search(m: GameMap, from: Cell, to: Cell): { seconds: number; path: Cell[] } | null {
  const h = m.rows.length, w = m.rows[0]?.length ?? 0;
  const at = (c: Cell) => c.y * w + c.x;
  const inside = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h;
  if (!inside(from) || !inside(to)) return null;
  const key = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const heap = new Heap();
  key[at(from)] = 0;
  heap.push(0, at(from));
  const goal = at(to);
  while (heap.size) {
    const [k, i] = heap.pop();
    if (k > key[i]) continue;
    if (i === goal) {
      const path: Cell[] = [];
      for (let j = i; j !== -1; j = prev[j]) path.push({ x: j % w, y: Math.floor(j / w) });
      return { seconds: Math.floor(k / TIE), path: path.reverse() };
    }
    const x = i % w, y = Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const cost = COST[m.rows[ny][nx]];
      if (!cost) continue;
      const j = ny * w + nx;
      const next = k + cost * TIE + (cost > 1 ? 1 : 0);
      if (next < key[j]) { key[j] = next; prev[j] = i; heap.push(next, j); }
    }
  }
  return null;
}

/** Seconds to walk the cheapest way from one tile to another; Infinity when there is no way. */
export const bestPath = (m: GameMap, from: Cell, to: Cell): number => search(m, from, to)?.seconds ?? Infinity;

/** The tiles of the cheapest way, first to last; empty when there is none. */
export const bestRoute = (m: GameMap, from: Cell, to: Cell): Cell[] => search(m, from, to)?.path ?? [];

class Heap {
  private keys: number[] = [];
  private items: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, v: number) {
    const { keys, items } = this;
    let i = keys.length;
    keys.push(k); items.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p]; items[i] = items[p]; i = p;
    }
    keys[i] = k; items[i] = v;
  }
  pop(): [number, number] {
    const { keys, items } = this;
    const top: [number, number] = [keys[0], items[0]];
    const k = keys.pop()!, v = items.pop()!;
    if (keys.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= keys.length) break;
        if (c + 1 < keys.length && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; items[i] = items[c]; i = c;
      }
      keys[i] = k; items[i] = v;
    }
    return top;
  }
}

// ─── fields ─────────────────────────────────────────────────────────────────

/** Columns between the legs of a field's meander: a 5-wide band, three walls, the next leg's band. */
const GAP = 8;
/** How far a side branch runs off the band, in tiles. */
const SPUR = { min: 4, max: 8 } as const;
const HALF = 2;
/** The shortest straight run a field ends on; below this the fit is not exact. */
const TAIL = 6;

const cellHash = (salt: number, x: number, y: number) =>
  mulberry32((salt ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0)();

/**
 * A field between two linked places, sized so its best path, portal to portal,
 * costs exactly the link's time (W1's budget).
 *
 * A centreline winds in vertical legs, GAP columns apart, and ends on a straight
 * run; the band is everything within two tiles of it. Walking cuts the corners
 * the centreline turns, so the band is MEASURED, and the straight run at the end
 * takes up whatever the corners saved: past its first few tiles every tile of it
 * adds exactly one second. Rough ground sits off the centreline, the more in a
 * harder biome; wherever the best path crossed some, it is trodden open, so the
 * best path is one tile a second.
 *
 * `ponytail: a square-wave meander with no side branches. Draw branches and a
 * larger-scale wind when W4 shows a field to someone.`
 */
function drawField(world: World, region: Region, lo: PlaceId, hi: PlaceId): GameMap {
  const id = fieldId(region.id, lo, hi);
  if (!region.places.find((p) => p.id === lo)?.connections.includes(hi)) {
    throw new Error(`map "${id}": no link between "${lo}" and "${hi}" in ${region.id}`);
  }
  const seconds = 60 * linkMinutes(world, lo, hi, region);
  const rng = mulberry32(Math.floor(pairDraw(world.seed, 0xf1e1d, lo, hi) * 2 ** 32));
  // The ends lie a third to two thirds of the budget apart.
  const third = Math.ceil(seconds / (3 * GAP));
  const turns = third + Math.floor(rng() * (third + 1));
  const weights = Array.from({ length: turns + 1 }, () => rng());
  const salt = Math.floor(rng() * 2 ** 32);
  const roughShare = 0.05 + (terrainFactor(region.biome) - 1) * 0.6;

  const centreline = (legs: number, tail: number): Cell[] => {
    const total = weights.reduce((s, w) => s + w, 0);
    const heights = weights.map((w) => Math.floor((legs * w) / total));
    for (let i = 0, left = legs - heights.reduce((s, n) => s + n, 0); left > 0; i++, left--) heights[i % heights.length]++;
    const line: Cell[] = [{ x: 0, y: 0 }];
    const step = (dx: number, dy: number) => { const c = line[line.length - 1]; line.push({ x: c.x + dx, y: c.y + dy }); };
    heights.forEach((h, i) => {
      for (let k = 0; k < h; k++) step(0, i % 2 === 0 ? -1 : 1);
      if (i < turns) for (let k = 0; k < GAP; k++) step(1, 0);
    });
    for (let k = 0; k < tail; k++) step(1, 0);
    return line;
  };

  // Everything from here to the far end is the straight run, and stays open.
  const runFrom = turns * GAP - HALF;
  const paint = (line: Cell[], trodden: Set<string>): GameMap => {
    const on = new Set(line.map((c) => `${c.x},${c.y}`));
    const band = new Set<string>();
    for (const c of line) for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) band.add(`${c.x + dx},${c.y + dy}`);
    // SIDE BRANCHES: one-tile spurs off the band into the wall, each stopping
    // before it touches anything else, so a branch is always a dead end and the
    // best path across the field is untouched.
    const open = (x: number, y: number) => band.has(`${x},${y}`) || spur.has(`${x},${y}`);
    const spur = new Set<string>();
    for (const c of line) {
      if (cellHash(salt ^ 0x5adf, c.x, c.y) > 0.04 || c.x >= runFrom) continue;
      const dir = cellHash(salt ^ 0x11, c.x, c.y) < 0.5 ? 1 : -1;
      const length = SPUR.min + Math.floor(cellHash(salt ^ 0x22, c.x, c.y) * (SPUR.max - SPUR.min + 1));
      for (let k = 1; k <= length; k++) {
        const at = { x: c.x, y: c.y + dir * (HALF + k) };
        // Free means: nothing walkable around it but the spur cell behind it.
        let touches = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
          if (open(at.x + dx, at.y + dy)) touches++;
        }
        if (touches > (k === 1 ? 3 : 1)) break;
        spur.add(`${at.x},${at.y}`);
      }
    }
    for (const k of spur) band.add(k);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of band) {
      const [x, y] = k.split(',').map(Number);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const grid = Array.from({ length: maxY - minY + 3 }, () => Array<string>(maxX - minX + 3).fill('#'));
    for (const k of band) {
      const [x, y] = k.split(',').map(Number);
      const rough = !on.has(k) && !trodden.has(k) && x < runFrom && cellHash(salt, x, y) < roughShare;
      grid[y - minY + 1][x - minX + 1] = rough ? ',' : '.';
    }

    const local = (c: Cell): Cell => ({ x: c.x - minX + 1, y: c.y - minY + 1 });
    return { id, kind: 'field', rows: grid.map((r) => r.join('')), ends: [local(line[0]), local(line[line.length - 1])] };
  };

  // Fit the legs so the straight run has little to take up, then let it take up the rest.
  let legs = seconds - turns * GAP - TAIL;
  let fit: { legs: number; line: Cell[]; trodden: Set<string>; short: number } | null = null;
  for (let tries = 0; tries < 8; tries++) {
    const line = centreline(legs, TAIL);
    const rough = paint(line, new Set());
    const route = bestRoute(rough, rough.ends![0], rough.ends![1]);
    const offset = { x: line[0].x - rough.ends![0].x, y: line[0].y - rough.ends![0].y };
    const trodden = new Set(route.filter((c) => rough.rows[c.y][c.x] === ',').map((c) => `${c.x + offset.x},${c.y + offset.y}`));
    const short = seconds - (route.length - 1);
    if (short >= 0) fit = { legs, line, trodden, short };
    if (short >= 0 && short <= 2 * GAP) break;
    legs = Math.max(0, legs + short - (short < 0 ? 1 : 0));
  }
  // The first try always fits: its centreline alone, all open, costs exactly the budget.
  const { legs: fitted, trodden, short } = fit!;
  const map = paint(centreline(fitted, TAIL + short), trodden);
  const cost = bestPath(map, map.ends![0], map.ends![1]);
  if (cost !== seconds) throw new Error(`map "${id}": drawn at ${cost}s, budget ${seconds}s`);
  return map;
}

// ─── hubs ───────────────────────────────────────────────────────────────────

/** How far a hub reaches from its centre, in tiles. */
const HUB_RADIUS: Record<PlaceKind, number> = { settlement: 24, gate: 10, landmark: 14, dungeon: 14, wild: 18 };

/**
 * A hub: a union of ellipses about one centre, so every tile of it is in sight of
 * the centre along a straight line and a door dealt anywhere on its edge is
 * reachable from every other. Streets, plots and buildings are W8.
 */
function drawHub(world: World, region: Region, place: PlaceId, kind: PlaceKind): GameMap {
  // A settlement is as wide as it GREW (DESIGN 6c §3c-ii); anything else is as
  // wide as its kind — a dry well has no tier, and inventing one would say nothing.
  const tier = tierOf(world, region.id, place);
  const r = tier ? CAPS[tier].radius : HUB_RADIUS[kind];
  const rng = mulberry32(Math.floor(pairDraw(world.seed, 0x4b0b, region.id, place) * 2 ** 32));
  const blobs = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({ rx: r * (0.4 + 0.6 * rng()), ry: r * (0.4 + 0.6 * rng()) }));
  const c = r + 1;
  const rows = Array.from({ length: 2 * r + 3 }, (_, y) =>
    Array.from({ length: 2 * r + 3 }, (_, x) =>
      blobs.some((b) => ((x - c) / b.rx) ** 2 + ((y - c) / b.ry) ** 2 <= 1) ? '.' : '#').join(''));
  return { id: hubId(region.id, place), kind: 'hub', rows };
}

/** The last open tile on a straight line out from a hub's centre. */
function edgeAt(m: GameMap, angle: number): Cell {
  const cx = Math.floor((m.rows[0].length) / 2), cy = Math.floor(m.rows.length / 2);
  let last: Cell = { x: cx, y: cy };
  for (let t = 0.5; ; t += 0.5) {
    const x = Math.round(cx + t * Math.cos(angle)), y = Math.round(cy + t * Math.sin(angle));
    if (m.rows[y]?.[x] !== '.') return last;
    last = { x, y };
  }
}

/**
 * Every door of a map, read off the place graph NOW (see the head of this file).
 * A hub has one per link from its place, one per way out through it, and the
 * stairs where the region's stack puts them; a field has its two ends.
 */
export function portalsOf(world: World, m: GameMap): Portal[] {
  const at = parse(m.id);
  const region = regionOf(world, at.region, m.id);
  if (at.kind === 'field') {
    const [a, b] = m.ends!;
    return [{ ...a, to: hubId(region.id, at.lo) }, { ...b, to: hubId(region.id, at.hi) }];
  }
  const place = region.places.find((p) => p.id === at.place);
  if (!place) throw new Error(`map "${m.id}": no place "${at.place}" in ${region.id}`);
  // Doors are placed in a fixed order and each takes the first free edge tile
  // turning from its dealt bearing, so no two share a tile. The order puts what
  // can be revealed LAST — a link never changes, nor does the way down; the way up
  // and a road can be found in play — so a revealed door never moves an older one.
  // ponytail: a way up found after a road was can still displace that road's door.
  const taken = new Set<string>();
  const door = (target: string): Cell => {
    const bearing = pairDraw(world.seed, 0x9047, place.id, target) * 2 * Math.PI;
    for (let k = 0; k < 64; k++) {
      const turn = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * Math.PI / 64);
      const at = edgeAt(m, bearing + turn);
      if (!taken.has(`${at.x},${at.y}`)) { taken.add(`${at.x},${at.y}`); return at; }
    }
    throw new Error(`map "${m.id}": no free edge tile for a door to "${target}"`);
  };

  const stack = !(region.exits ?? []).some((l) => l.direction);
  const down = stack && region.entrance === place.id ? [regionIdFor(region.floor - 1)] : [];
  const up = stack && region.exit === place.id ? [regionIdFor(region.floor + 1)] : [];
  const roads = (region.exits ?? []).filter((l) => l.via === place.id).map((l) => l.to);
  return [
    ...place.connections.map((c) => ({ ...door(c), to: fieldId(region.id, place.id, c) })),
    ...[...new Set([...down, ...up, ...roads])].map((to) => ({ ...door(to), region: to })),
  ];
}
