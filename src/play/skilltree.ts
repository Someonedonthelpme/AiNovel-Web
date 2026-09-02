import type { Ability, Abilities } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { ARCHETYPES, archetypeForBackground, skillFrom } from './archetypes.ts';
import { classById, subclassById } from '../character/classes.ts';
import type { CharacterClass } from '../character/classes.ts';
import type { Archetype, ArchetypeId } from './archetypes.ts';
import type { TraitCondition } from './traits.ts';
import { graftFor } from './graft.ts';
import type { GraftSource, GraftSpec } from './graft.ts';
import { traitsFor } from './traitbook.ts';
import { CANDIDATE_SIGNETS } from './signetbook.ts';
import { stagesReached, SUBCLASS_STAGES } from '../character/classes.ts';
import type { ReadBook } from '../session/sheet.ts';

/**
 * The passive tree.
 *
 * Path of Exile-shaped: a web entered where your background puts you, where a
 * point may only be spent on a node ADJACENT to one you already hold.
 * Contiguity is the whole mechanic — a distant node means paying for the
 * route, so a build is the path you took rather than a shopping list.
 *
 * Twelve DISCIPLINES exist. Each leans on its own abilities and TEACHES two
 * active skills at its notables, so walking a branch changes what you can do
 * and not only what your numbers are.
 *
 * THREE THINGS MAKE ONE CHARACTER'S TREE UNLIKE ANOTHER'S.
 *
 * It holds a SUBSET. A character gets their home discipline plus a handful
 * drawn by seed, weighted towards ones that go with it — so a soldier and a
 * scholar are not looking at the same map with a different door. What is not
 * on your tree is not available at any price.
 *
 * Branches have SHAPES. A chain, a fork that splits into two arms, a wheel you
 * can walk around either way, a spur hung with side-pockets. Depth varies too.
 * A perfectly radial tree is a wheel, and a wheel has no decisions in it.
 *
 * And some clusters are ISLANDS — detached, unreachable, invisible, until
 * something you do in play opens the bridge to them. That is the dynamic half:
 * the tree grows as the character does, and it is where the Signet gates will
 * eventually attach.
 */

export const NODE_KINDS = ['minor', 'notable', 'keystone'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export type NodeGrant = {
  ability?: Partial<Abilities>;
  maxHp?: number;
  ac?: number;
  attack?: number;
  damage?: number;
};

export type SkillNode = {
  id: string;
  name: string;
  description: string;
  kind: NodeKind;
  /** Which discipline this belongs to. Drives colour and grouping in the UI. */
  archetype: ArchetypeId;
  /** Rings out from the start. Drives both power and layout. */
  ring: number;
  x: number;
  y: number;
  connections: string[];
  grant: NodeGrant;
  /** Keystones give with one hand and take with the other. */
  cost?: NodeGrant;
  /** Notables teach. This is where actives live in the tree. */
  teaches?: ActiveSkill;
  /**
   * Hidden until earned. A node with unmet requirements is not drawn at all —
   * the dynamic half of the tree, and where Signet gates attach.
   */
  requires?: TraitCondition[];
  /**
   * A COMBINATION entry: every one of these must be held before the node opens.
   *
   * Everywhere else a node needs any one neighbour, so this is the only thing
   * on the tree you plan for rather than walk to.
   */
  requiresAll?: string[];
  /**
   * A PARALLEL entry: needs nothing held at all.
   *
   * The trait, Signet or book that grew this branch already paid the entry, so
   * contiguity has nothing to say about it. You did not walk here; you read
   * your way in.
   */
  freeStanding?: boolean;
  /** Which system grew this branch, so the panel can say why it is there. */
  grafted?: GraftSource;
};

export type SkillTree = {
  id: string;
  start: string;
  /** Which discipline the character opens next to. */
  home: ArchetypeId;
  /** The subset this character's tree holds. What is absent is absent for good. */
  disciplines: ArchetypeId[];
  nodes: SkillNode[];
};

export type Lang = 'th' | 'en';

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/** The deepest a branch can run. Individual branches stop short of this. */
export const RINGS = 8;

/** How many disciplines one character's tree holds, home included. */
export const MIN_DISCIPLINES = 5;
export const MAX_DISCIPLINES = 7;

/**
 * Which disciplines sit well together.
 *
 * Used to weight the draw, so a tree reads as a character rather than as a
 * random handful: someone who works with figures is more likely to be offered
 * fire and poison than the shield.
 */
const AFFINITY: Record<ArchetypeId, ArchetypeId[]> = {
  sword: ['guard', 'shadow', 'survival'],
  bow: ['shadow', 'wisdom', 'survival'],
  guard: ['sword', 'survival', 'song'],
  wisdom: ['magic', 'bow', 'song'],
  magic: ['flame', 'venom', 'wisdom'],
  blackMagic: ['venom', 'shadow', 'magic'],
  guile: ['shadow', 'song', 'venom'],
  survival: ['bow', 'guard', 'venom'],
  flame: ['magic', 'blackMagic', 'sword'],
  venom: ['magic', 'blackMagic', 'guile'],
  shadow: ['guile', 'bow', 'blackMagic'],
  song: ['guile', 'wisdom', 'guard'],
};

/** The shapes a branch can take. A tree of one shape is a wheel. */
const SHAPES = ['chain', 'fork', 'wheel', 'spur'] as const;
type Shape = (typeof SHAPES)[number];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const nodeId = (archetype: ArchetypeId, ring: number) => `${archetype}_r${ring}`;

/**
 * What a node at this depth is worth.
 *
 * Power rises with distance from the centre, which is what makes a long route
 * a real investment rather than a longer way to the same place.
 */
function grantFor(archetype: Archetype, kind: NodeKind, ring: number, roll: number): NodeGrant {
  if (kind === 'keystone') return {};

  if (kind === 'notable') {
    return ring >= 5
      ? { ability: { [archetype.ability]: 1, [archetype.secondary]: 1 }, maxHp: 4 }
      : { ability: { [archetype.ability]: 1 }, ...(roll < 0.5 ? { attack: 1 } : { ac: 1 }) };
  }

  // Minors alternate between the discipline's ability and raw staying power, so
  // a branch is not purely one number going up.
  if (roll < 0.55) return { ability: { [archetype.ability]: 1 } };
  if (roll < 0.8) return { maxHp: 3 };
  return { ability: { [archetype.secondary]: 1 } };
}

/** A keystone's trade, themed to its discipline rather than drawn from a pot. */
function keystoneTrade(archetype: Archetype): { grant: NodeGrant; cost: NodeGrant } {
  switch (archetype.id) {
    case 'sword': return { grant: { damage: 2, attack: 1 }, cost: { maxHp: 6 } };
    case 'bow': return { grant: { attack: 2, damage: 1 }, cost: { ac: 2 } };
    case 'guard': return { grant: { ac: 2, maxHp: 8 }, cost: { attack: 1 } };
    case 'wisdom': return { grant: { ability: { wis: 2 }, ac: 1 }, cost: { damage: 1 } };
    case 'magic': return { grant: { ability: { int: 2, wis: 1 } }, cost: { ability: { str: 2 } } };
    case 'blackMagic': return { grant: { ability: { int: 2 }, damage: 2 }, cost: { maxHp: 8 } };
    case 'guile': return { grant: { ability: { cha: 2, dex: 1 } }, cost: { maxHp: 4 } };
    case 'survival': return { grant: { maxHp: 12, ability: { con: 1 } }, cost: { damage: 1 } };
    // Fire does not know who it was aimed at: enormous reach, and you are in it.
    case 'flame': return { grant: { damage: 3 }, cost: { maxHp: 6, ac: 1 } };
    case 'venom': return { grant: { ability: { int: 1, dex: 1 }, damage: 1 }, cost: { attack: 1 } };
    case 'shadow': return { grant: { damage: 3, attack: 1 }, cost: { maxHp: 8 } };
    case 'song': return { grant: { ability: { cha: 2, wis: 1 }, maxHp: 4 }, cost: { damage: 1 } };
  }
}

const describe = (grant: NodeGrant, cost: NodeGrant | undefined, language: Lang): string => {
  const parts: string[] = [];
  const add = (g: NodeGrant, sign: string) => {
    for (const [ability, n] of Object.entries(g.ability ?? {})) parts.push(`${sign}${n} ${ability}`);
    if (g.maxHp) parts.push(`${sign}${g.maxHp} hp`);
    if (g.ac) parts.push(`${sign}${g.ac} armour`);
    if (g.attack) parts.push(`${sign}${g.attack} to hit`);
    if (g.damage) parts.push(`${sign}${g.damage} damage`);
  };
  add(grant, '+');
  if (cost) add(cost, '-');
  return parts.join(', ') || (language === 'th' ? 'ทางผ่าน' : 'a step along the way');
};

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pick the disciplines this character's tree actually contains.
 *
 * Home is guaranteed. The rest are drawn with affinity weighting, so the set
 * hangs together — and because it is a SUBSET, what is missing is missing for
 * good. A soldier cannot buy their way into black magic; that tree was never
 * printed for them.
 */
function disciplinesFor(rng: () => number, home: ArchetypeId, held: CharacterClass | null): Archetype[] {
  /*
   * The hard lock.
   *
   * A class does not merely favour some disciplines; it is shut out of others
   * permanently, at any price. That is what makes an island worth finding —
   * without it, every tree could eventually contain everything and a detached
   * cluster would just be more nodes arriving late.
   */
  const barred = new Set<ArchetypeId>(held?.forbidden ?? []);
  const allowed = (id: ArchetypeId) => !barred.has(id);

  const chosen = new Set<ArchetypeId>();
  if (held) for (const id of held.core) chosen.add(id);
  chosen.add(home);

  const want = MIN_DISCIPLINES + Math.floor(rng() * (MAX_DISCIPLINES - MIN_DISCIPLINES + 1));

  // The class's own leanings first, then the general affinities of whatever is
  // already in — so the set reads as a character rather than a handful.
  const pool = () => {
    const near: ArchetypeId[] = [];
    for (const friend of held?.affinity ?? []) if (!chosen.has(friend) && allowed(friend)) near.push(friend);
    for (const id of chosen) {
      for (const friend of AFFINITY[id]) if (!chosen.has(friend) && allowed(friend)) near.push(friend);
    }
    return near;
  };

  let guard = 0;
  while (chosen.size < want && guard++ < 64) {
    const near = pool();
    if (near.length > 0 && rng() < 0.7) {
      chosen.add(near[Math.floor(rng() * near.length)]);
      continue;
    }
    const any = ARCHETYPES.filter((a) => !chosen.has(a.id) && allowed(a.id));
    if (any.length === 0) break;
    chosen.add(any[Math.floor(rng() * any.length)].id);
  }

  // Home first, so it faces outward under the player's hand when the tree opens.
  return [...chosen]
    .map((id) => ARCHETYPES.find((a) => a.id === id)!)
    .sort((a, b) => (a.id === home ? -1 : b.id === home ? 1 : 0));
}

type Placed = { node: SkillNode; ring: number };

/**
 * Lay one discipline out in whatever shape it drew.
 *
 * Every shape is a chain with something done to it — a fork splits, a wheel
 * closes back on itself, a spur hangs pockets off the side. Kind is decided by
 * position rather than by a fixed ring, so notables and keystones land at
 * different depths on different branches.
 */
function growBranch(
  rng: () => number,
  archetype: Archetype,
  shape: Shape,
  angle: number,
  language: Lang,
  startId: string,
): Placed[] {
  const depth = 4 + Math.floor(rng() * 4);
  const placed: Placed[] = [];
  let taught = 0;

  const at = (ring: number, spread: number): { x: number; y: number } => {
    const radius = 6 + ring * 5.4;
    const drift = spread + (rng() - 0.5) * 0.1;
    return { x: 50 + Math.cos(angle + drift) * radius, y: 50 + Math.sin(angle + drift) * radius };
  };

  const make = (
    suffix: string,
    ring: number,
    kind: NodeKind,
    spread: number,
    parents: string[],
  ): SkillNode => {
    const pos = at(ring, spread);
    const node: SkillNode = {
      id: `${archetype.id}_${suffix}`,
      name: '',
      description: '',
      kind,
      archetype: archetype.id,
      ring,
      x: pos.x,
      y: pos.y,
      connections: parents,
      grant: {},
    };

    if (kind === 'keystone') {
      const trade = keystoneTrade(archetype);
      node.name = archetype.keystone[language];
      node.description = archetype.keystoneNote[language];
      node.grant = trade.grant;
      node.cost = trade.cost;
      node.requires = [{ kind: 'level', atLeast: 5 + Math.floor(rng() * 4) }];
    } else if (kind === 'notable') {
      const which = (taught === 0 ? 0 : 1) as 0 | 1;
      node.name = archetype.notables[which][language];
      node.grant = grantFor(archetype, kind, ring, rng());
      node.teaches = skillFrom(archetype, which, language);
      node.description = describe(node.grant, undefined, language);
      taught += 1;
    } else {
      node.name = archetype.minors[Math.floor(rng() * archetype.minors.length)][language];
      node.grant = grantFor(archetype, kind, ring, rng());
      node.description = describe(node.grant, undefined, language);
    }

    placed.push({ node, ring });
    return node;
  };

  // The spine every shape is built on.
  let previous = startId;
  const spine: SkillNode[] = [];
  for (let ring = 1; ring <= depth; ring++) {
    const last = ring === depth;
    const middle = ring === Math.max(2, Math.floor(depth / 2));
    const kind: NodeKind = last ? 'keystone' : middle ? 'notable' : 'minor';
    const node = make(`r${ring}`, ring, kind, 0, [previous]);
    spine.push(node);
    previous = node.id;
  }

  if (shape === 'fork' && depth >= 4) {
    // A second arm off the middle, ending in the discipline's other notable.
    const from = spine[Math.floor(depth / 2) - 1];
    let arm = from.id;
    for (let i = 1; i <= 2; i++) {
      const kind: NodeKind = i === 2 ? 'notable' : 'minor';
      arm = make(`f${i}`, from.ring + i, kind, 0.42, [arm]).id;
    }
  }

  if (shape === 'wheel' && depth >= 4) {
    // A loop you can walk around either way, so the route in is a choice.
    const anchor = spine[1];
    const left = make('w1', anchor.ring + 1, 'minor', -0.34, [anchor.id]);
    const right = make('w2', anchor.ring + 1, 'minor', 0.34, [anchor.id]);
    const cap = make('w3', anchor.ring + 2, 'notable', 0, [left.id, right.id]);
    void cap;
  }

  if (shape === 'spur') {
    // Side-pockets: cheap detours that pay once and go nowhere.
    for (let i = 0; i < 2; i++) {
      const anchor = spine[1 + Math.floor(rng() * Math.max(1, spine.length - 2))];
      make(`s${i}`, anchor.ring, 'minor', rng() < 0.5 ? -0.3 : 0.3, [anchor.id]);
    }
  }

  return placed;
}

/**
 * A cluster with no way in yet.
 *
 * Drawn nowhere near the spokes and connected by a single bridge whose
 * requirement has to come true first. Until then `visibleNodes` omits the whole
 * thing, so the player does not know it is there — which is the difference
 * between a locked door and a secret.
 */
function growIsland(
  rng: () => number,
  archetype: Archetype,
  index: number,
  language: Lang,
  bridgeTo: string,
): SkillNode[] {
  const angle = rng() * Math.PI * 2;
  const radius = 41 + rng() * 6;
  const cx = 50 + Math.cos(angle) * radius;
  const cy = 50 + Math.sin(angle) * radius;

  // What opens it. Different islands answer to different kinds of play.
  const keys: TraitCondition[][] = [
    [{ kind: 'counter', counter: 'deepest_floor', atLeast: 4 + index * 3 }],
    [{ kind: 'counter', counter: 'kills', atLeast: 15 + index * 15 }],
    [{ kind: 'level', atLeast: 5 + index * 2 }],
    [{ kind: 'counter', counter: 'floors_climbed', atLeast: 6 + index * 4 }],
  ];
  const requires = keys[index % keys.length];

  const nodes: SkillNode[] = [];
  const gate: SkillNode = {
    id: `isle${index}_gate`,
    name: language === 'th' ? 'สะพาน' : 'The Crossing',
    description: language === 'th' ? 'ทางที่เพิ่งเปิด' : 'A way across that was not there before.',
    kind: 'minor',
    archetype: archetype.id,
    ring: 9,
    x: cx,
    y: cy,
    connections: [bridgeTo],
    grant: { maxHp: 2 },
    requires,
  };
  nodes.push(gate);

  const heart: SkillNode = {
    id: `isle${index}_heart`,
    name: archetype.notables[index % 2][language],
    description: '',
    kind: 'notable',
    archetype: archetype.id,
    ring: 10,
    x: cx + Math.cos(angle) * 5,
    y: cy + Math.sin(angle) * 5,
    connections: [gate.id],
    grant: grantFor(archetype, 'notable', 6, rng()),
    teaches: skillFrom(archetype, (index % 2) as 0 | 1, language),
    requires,
  };
  heart.description = describe(heart.grant, undefined, language);
  nodes.push(heart);

  return nodes;
}

export type TreeOptions = {
  language?: Lang;
  backgroundName?: string;
  /** What the player chose. Absent on every session made before classes existed. */
  classId?: string;
  /** Chosen at level 3, and paying out again at 6 and 10. */
  subclassId?: string;
  /** Drives which subclass stages have grown. */
  level?: number;
  /** Traits earned, Signets claimed, books read — each may grow a branch. */
  traits?: readonly string[];
  signets?: readonly string[];
  /** Books carry the branch they grow, so a sword book grows sword nodes. */
  books?: readonly ReadBook[];
};

export function skillTreeFor(
  seed: number,
  backgroundId: string,
  language: Lang = 'en',
  backgroundName = '',
  options: Omit<TreeOptions, 'language' | 'backgroundName'> = {},
): SkillTree {
  const held = classById(options.classId);
  const chosenSub = subclassById(options.classId, options.subclassId);

  const rng = mulberry32(
    (seed ^ hash(backgroundId) ^ hash(backgroundName) ^ hash(options.classId ?? '')) >>> 0,
  );

  /*
   * The class decides where the tree opens. Falling back to the background
   * matcher keeps every session made before classes existed working exactly as
   * it did — a stored tree must not rearrange itself under a save.
   */
  const home = held ? held.core[0] : archetypeForBackground(backgroundId, backgroundName);
  const nodes: SkillNode[] = [];

  const start: SkillNode = {
    id: 'start',
    name: language === 'th' ? 'จุดเริ่ม' : 'Origin',
    description: language === 'th' ? 'จุดที่ทุกอย่างเริ่มต้น' : 'Where everything starts.',
    kind: 'minor',
    archetype: home,
    ring: 0,
    x: 50,
    y: 50,
    connections: [],
    grant: {},
  };
  nodes.push(start);

  const chosen = disciplinesFor(rng, home, held);
  const shapes = new Map<ArchetypeId, Shape>();

  chosen.forEach((archetype, index) => {
    // Angles are spread but not even — a perfectly regular fan reads as a wheel.
    const base = (index / chosen.length) * Math.PI * 2 - Math.PI / 2;
    const angle = base + (rng() - 0.5) * 0.5;
    const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
    shapes.set(archetype.id, shape);

    for (const { node } of growBranch(rng, archetype, shape, angle, language, start.id)) {
      nodes.push(node);
    }
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Bridges between branches, at whatever depths the seed picks. Some are long:
  // a link to the branch two along, which is what stops the web looking woven.
  for (let i = 0; i < chosen.length; i++) {
    const bridges = Math.floor(rng() * 3);
    for (let b = 0; b < bridges; b++) {
      const hop = rng() < 0.75 ? 1 : 2;
      const here = chosen[i];
      const there = chosen[(i + hop) % chosen.length];
      if (here.id === there.id) continue;

      const from = nodes.filter((n) => n.archetype === here.id && n.ring >= 2 && n.ring <= 5);
      const to = nodes.filter((n) => n.archetype === there.id && n.ring >= 2 && n.ring <= 5);
      if (from.length === 0 || to.length === 0) continue;

      const a = from[Math.floor(rng() * from.length)];
      const z = to[Math.floor(rng() * to.length)];
      if (!a.connections.includes(z.id)) byId.get(a.id)?.connections.push(z.id);
    }
  }

  // Islands: one or two, hung off a branch tip, invisible until earned.
  const islands = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < islands; i++) {
    const host = chosen[Math.floor(rng() * chosen.length)];
    const tips = nodes.filter((n) => n.archetype === host.id && n.ring >= 3);
    if (tips.length === 0) continue;
    const anchor = tips[Math.floor(rng() * tips.length)];

    // Islands can belong to a discipline the tree does NOT otherwise hold —
    // the reward for playing a certain way is a door into something else, and
    // for a class that is shut out of somewhere, it is the ONLY door.
    const foreign = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
    for (const node of growIsland(rng, foreign, i, language, anchor.id)) {
      nodes.push(node);
      byId.set(node.id, node);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Grafts: everything the character earned rather than was given        */
  /* ------------------------------------------------------------------ */

  /*
   * Applied in a fixed order, each seeing every node placed before it — so a
   * branch can anchor on an earlier branch and the tree grows outward in
   * layers rather than sprouting disconnected tufts.
   *
   * Order is by source and id rather than by when it happened, because the
   * tree has to come out the same on a reload however the log is folded.
   */
  const grown: SkillNode[] = [...nodes];
  const attach = (id: string, spec: GraftSpec, source: GraftSource) => {
    /*
     * A graft may hang from anywhere already placed, including earlier grafts —
     * which is what makes the tree grow in layers rather than sprouting tufts
     * around the same old web.
     *
     * Earlier branches are offered PREFERENTIALLY. Left to an even draw they
     * would almost never be chosen: forty-odd main-tree nodes against a
     * handful of grafted ones means layering would be a rarity rather than the
     * shape of the thing.
     */
    const placeable = grown.filter((n) => n.id !== start.id && !n.freeStanding);
    const onGrafts = placeable.filter((n) => n.grafted);
    const anchors = onGrafts.length > 0 && rng() < 0.55 ? onGrafts : placeable;
    const drift = { x: 50 + (rng() - 0.5) * 70, y: 50 + (rng() - 0.5) * 70 };

    for (const node of graftFor(rng, { id, spec, source, anchors, language, drift })) {
      grown.push(node);
      byId.set(node.id, node);
      nodes.push(node);
    }
  };

  for (const traitId of [...(options.traits ?? [])].sort()) {
    const trait = traitsFor(seed).find((t) => t.id === traitId);
    if (trait?.opens) attach(`trait_${trait.id}`, trait.opens, { kind: 'trait', id: trait.id, name: trait.name });
  }

  for (const signetId of [...(options.signets ?? [])].sort()) {
    const signet = CANDIDATE_SIGNETS.find((x) => x.id === signetId);
    if (signet?.opens) {
      attach(`signet_${signet.id}`, signet.opens, { kind: 'signet', id: signet.id, name: signet.name });
    }
  }

  /*
   * Subclass stages. Three payouts rather than one parcel, the first a
   * COMBINATION — the crossing into a discipline the class is shut out of only
   * opens once several parts of the character's own tree line up.
   */
  if (chosenSub) {
    const reached = stagesReached(options.level ?? 1);
    for (let stage = 0; stage < reached; stage++) {
      const shape = SUBCLASS_STAGES[stage];
      attach(
        `sub_${chosenSub.id}_${stage}`,
        { archetype: chosenSub.opens, entry: shape.entry, size: shape.size, needs: shape.needs },
        { kind: 'subclass', id: chosenSub.id, name: chosenSub.name[language] },
      );
    }
  }

  /*
   * Skill sets from books, last and always PARALLEL: you did not walk to a
   * book, you read your way in, and the reading was the entry price.
   */
  for (const read of [...(options.books ?? [])].sort((a, b) => a.bookId.localeCompare(b.bookId))) {
    // The book's OWN set, so a book about steadiness grows shield nodes rather
    // than everything defaulting to the same discipline.
    attach(`book_${read.bookId}`, read.set, { kind: 'book', id: read.bookId, name: read.name });
  }

  return {
    id: `tree_${backgroundId}`,
    start: start.id,
    home,
    disciplines: chosen.map((a) => a.id),
    nodes: linkBothWays([...byId.values()]),
  };
}

/** Edges are undirected; the generator writes only one side. */
function linkBothWays(nodes: SkillNode[]): SkillNode[] {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, connections: [...n.connections] }]));
  for (const node of nodes) {
    for (const to of node.connections) {
      const other = byId.get(to);
      if (other && !other.connections.includes(node.id)) other.connections.push(node.id);
    }
  }
  return [...byId.values()];
}

export { ARCHETYPES } from './archetypes.ts';
export type { ArchetypeId } from './archetypes.ts';
