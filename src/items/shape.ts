/**
 * Shapes, boards, and whether a thing fits.
 *
 * The slot inventory model — Tarkov, Resident Evil, PoE — where what you can
 * carry is not a number but a packing problem. Its whole appeal is that
 * deciding WHAT TO LEAVE BEHIND is a decision with a shape to it, rather than
 * an arithmetic comparison against a limit.
 *
 * Three things make this different from a rectangle grid:
 *
 * A SHAPE IS AN ARBITRARY POLYOMINO. A one-headed axe is an L, a two-headed axe
 * is a T, a longsword is a line of five or six, a dagger is two. Shapes are
 * ASSEMBLED FROM SQUARES — see `join` — so a generated weapon can get its
 * silhouette from the parts it was generated with rather than needing a mask
 * authored per item.
 *
 * A BOARD IS ALSO AN ARBITRARY SHAPE. A container is not a w×h rectangle; it is
 * whatever cells it has. A saddlebag with a notch out of it is expressible, and
 * so is a rig with two separate compartments.
 *
 * EVERYTHING HERE IS PURE AND DETERMINISTIC. `firstFit` scans in a fixed order
 * and rotations are tried in a fixed order, because auto-placement happens
 * inside the fold — a pack that packed itself differently on replay would be a
 * different pack, and the whole event log rests on that not happening.
 *
 * The weight model does not use any of this. Both models are ruleset
 * parameters over one code path: a world with no grid simply never asks.
 */

/** One cell, as an offset from an origin. */
export type Cell = { x: number; y: number };

/**
 * A set of cells, normalised so the top-left of its bounding box is (0,0).
 *
 * Normalising is what makes two shapes comparable and rotation composable —
 * without it, rotating twice would drift the origin and a shape would stop
 * equalling itself.
 */
export type Shape = { cells: Cell[] };

/** The cells a container actually has. Not necessarily a rectangle. */
export type Board = { cells: Cell[] };

export const cellKey = (c: Cell): string => `${c.x},${c.y}`;

/* -------------------------------------------------------------------------- */
/* Building shapes                                                             */
/* -------------------------------------------------------------------------- */

/** Sort into a canonical order so equal shapes compare equal. */
const ordered = (cells: Cell[]): Cell[] =>
  [...cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));

/** Slide a set of cells so its bounding box starts at the origin. */
export function normalise(cells: readonly Cell[]): Shape {
  if (cells.length === 0) return { cells: [] };
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const moved = cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));

  // Duplicates would make a shape count as two cells in one place, which reads
  // as an item that is heavier to pack than it looks.
  const seen = new Set<string>();
  const unique: Cell[] = [];
  for (const c of moved) {
    const key = cellKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return { cells: ordered(unique) };
}

/**
 * Read a shape from a mask, which is how anything authored is written.
 *
 *   'XXX/.X.'   a T
 *   'X./X./XX'  an L
 *   'XXXXX'     a longsword
 *
 * Rows are separated by `/`; anything that is not `.` or a space is a cell.
 * Being readable in source matters more here than being compact — a mask you
 * cannot picture is a shape somebody will get wrong.
 */
export function shapeFrom(mask: string): Shape {
  const cells: Cell[] = [];
  mask.split('/').forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.' && ch !== ' ') cells.push({ x, y });
    });
  });
  return normalise(cells);
}

/** Render a shape back to a mask. For tests, and for looking at one. */
export function maskOf(shape: Shape | Board): string {
  if (shape.cells.length === 0) return '';
  const w = Math.max(...shape.cells.map((c) => c.x)) + 1;
  const h = Math.max(...shape.cells.map((c) => c.y)) + 1;
  const filled = new Set(shape.cells.map(cellKey));
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += filled.has(`${x},${y}`) ? 'X' : '.';
    rows.push(row);
  }
  return rows.join('/');
}

/**
 * Combine two shapes into one, `b` offset from `a`.
 *
 * This is what "assembled from squares" means in practice: a haft is a line, a
 * head is a blob, and an axe is the two joined. A generated weapon can then
 * take its silhouette from its own parts instead of needing a mask written for
 * every combination that generation can produce.
 */
export function join(a: Shape, b: Shape, offset: Cell = { x: 0, y: 0 }): Shape {
  return normalise([...a.cells, ...b.cells.map((c) => ({ x: c.x + offset.x, y: c.y + offset.y }))]);
}

/** A solid rectangle, the common case for a plain container. */
export function rect(width: number, height: number): Shape {
  const cells: Cell[] = [];
  for (let y = 0; y < Math.max(0, height); y++) {
    for (let x = 0; x < Math.max(0, width); x++) cells.push({ x, y });
  }
  return { cells: ordered(cells) };
}

export const area = (shape: Shape | Board): number => shape.cells.length;

/* -------------------------------------------------------------------------- */
/* Turning them                                                                */
/* -------------------------------------------------------------------------- */

/** A quarter turn clockwise: (x,y) → (maxY − y, x). */
export function rotate(shape: Shape): Shape {
  if (shape.cells.length === 0) return shape;
  const maxY = Math.max(...shape.cells.map((c) => c.y));
  return normalise(shape.cells.map((c) => ({ x: maxY - c.y, y: c.x })));
}

/**
 * Every distinct way a shape can sit, in a fixed order.
 *
 * Distinct matters: a 1×1 has one orientation and a square has one, so trying
 * four would place the same thing four times and make `firstFit` do four times
 * the work for nothing. The order is fixed because placement must replay.
 */
export function orientations(shape: Shape): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  let current = shape;
  for (let turn = 0; turn < 4; turn++) {
    const key = maskOf(current);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(current);
    }
    current = rotate(current);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Fitting                                                                     */
/* -------------------------------------------------------------------------- */

/** Something sitting on a board: which shape, where, and whose it is. */
export type Placement = { id: string; shape: Shape; at: Cell };

/** Every cell a placement covers. */
export const cellsOf = (p: Placement): Cell[] =>
  p.shape.cells.map((c) => ({ x: c.x + p.at.x, y: c.y + p.at.y }));

/** What is already taken, as keys, so a fit check is a set lookup. */
export function occupiedCells(placements: readonly Placement[]): Set<string> {
  const taken = new Set<string>();
  for (const p of placements) for (const c of cellsOf(p)) taken.add(cellKey(c));
  return taken;
}

/**
 * Whether `shape` can sit at `at`: every cell of it must be a cell the board
 * has, and none of them may already be taken.
 *
 * Both halves are needed. Checking only the bounds would let something hang
 * over the notch in an irregular container; checking only collisions would let
 * it hang off the edge entirely.
 */
export function fits(
  board: Board,
  placements: readonly Placement[],
  shape: Shape,
  at: Cell,
  taken = occupiedCells(placements),
): boolean {
  const available = new Set(board.cells.map(cellKey));
  return shape.cells.every((c) => {
    const key = `${c.x + at.x},${c.y + at.y}`;
    return available.has(key) && !taken.has(key);
  });
}

/**
 * The first place this will go, scanning top-left to bottom-right.
 *
 * Deterministic by construction — a fixed scan order and a fixed rotation
 * order — because auto-placement runs inside the fold. Returns null when it
 * genuinely will not fit, which is the caller's cue to refuse the pickup or
 * spill it on the floor.
 */
export function firstFit(
  board: Board,
  placements: readonly Placement[],
  shape: Shape,
  canRotate = true,
): { at: Cell; shape: Shape } | null {
  if (shape.cells.length === 0) return null;
  const taken = occupiedCells(placements);
  const tries = canRotate ? orientations(shape) : [shape];

  // Scanning the board's own cells rather than a bounding box means an
  // irregular container is searched exactly where it has room.
  const spots = [...board.cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const at of spots) {
    for (const oriented of tries) {
      if (fits(board, placements, oriented, at, taken)) return { at, shape: oriented };
    }
  }
  return null;
}

/**
 * Pack a list of shapes onto a board, largest first.
 *
 * Largest-first because a big awkward piece placed last usually has nowhere to
 * go, while the small ones fill gaps around it — the standard heuristic, and
 * good enough that nobody has to solve bin packing to pick up a sword.
 *
 * `ponytail: greedy, not optimal. A perfect packer would sometimes fit one
 * more item; it would also be exponential and would rearrange somebody's bag
 * behind their back, which is worse than refusing the pickup.`
 */
export function packAll(
  board: Board,
  items: readonly { id: string; shape: Shape }[],
  canRotate = true,
): { placed: Placement[]; rejected: string[] } {
  const order = [...items].sort((a, b) => area(b.shape) - area(a.shape) || a.id.localeCompare(b.id));
  const placed: Placement[] = [];
  const rejected: string[] = [];

  for (const item of order) {
    const spot = firstFit(board, placed, item.shape, canRotate);
    if (!spot) {
      rejected.push(item.id);
      continue;
    }
    placed.push({ id: item.id, shape: spot.shape, at: spot.at });
  }
  return { placed, rejected };
}
