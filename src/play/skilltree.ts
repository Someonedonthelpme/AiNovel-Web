import type { Ability, Abilities } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { gateFor, isOpen, openPaths, pathsFor } from './pathgen.ts';
import type { Lean, PathShape } from './pathgen.ts';
import { grantForRing, keystoneTradeFor, PATH_WORDS } from './pathwords.ts';
import { composeSkill, nameFor } from '../skills/compose.ts';
import { STAT_GRAMMAR } from '../skills/statgrammar.ts';
import { budgetForFloor } from '../skills/book.ts';
import { classOf, subclassOf } from '../character/classes.ts';
import type { CharacterClass } from '../character/classes.ts';
import type { TraitCondition } from './traits.ts';
import { graftFor } from './graft.ts';
import type { GraftSource, GraftSpec } from './graft.ts';
import { traitsFor } from './traitbook.ts';
import { candidateSignetsFor } from './signetbook.ts';
import { EMERGENT_BRANCH_CAP, isEmergent } from './emergent.ts';
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
  /**
   * Pool ceilings, beyond what VIT and CON give.
   *
   * The only reward nothing else in the game grants, which is what makes it
   * worth having as a distinct one — and it is unmissable in a way a stat
   * bump is not, because the bar visibly lengthens.
   */
  maxStamina?: number;
  maxMana?: number;
};

export type SkillNode = {
  id: string;
  name: string;
  description: string;
  kind: NodeKind;
  /**
   * The path this belongs to, and the stat that path runs on.
   *
   * `archetype` was a hardcoded fantasy category and the last such thing in a
   * generated game. The path id groups a branch; the STAT drives its colour
   * and, through `statgrammar`, everything it is able to teach.
   */
  path: string;
  stat: Ability;
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
  /** The path the character opens next to — the one their spread opens best. */
  home: string;
  /**
   * Every path this world has, open or sealed.
   *
   * No longer a SUBSET fixed at creation. A class used to decide which
   * disciplines were on the tree for ever; a spread decides which are open
   * NOW, and a sealed path is present with its stat gate showing. What is
   * missing is missing until you raise the stat, not for good.
   */
  paths: string[];
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

const nodeId = (path: string, ring: number) => `${path}_r${ring}`;

/**
 * What a node at this depth is worth.
 *
 * Power rises with distance from the centre, which is what makes a long route
 * a real investment rather than a longer way to the same place.
 */
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
 * What a notable on this path teaches.
 *
 * Composed from the STAT'S grammar, so a notable can only ever teach something
 * its path is genuinely capable of — a path running on STR cannot produce a
 * skill that heals from across the room, whatever the world happens to call it.
 * That is the coherence guarantee discipline grammar used to give, moved onto
 * the stat where it belongs.
 *
 * Keyed on the NODE id rather than the world seed, so the same node always
 * teaches the same thing: a character who took it at level four and reloads at
 * twelve must not find it has become something else.
 */
function teachFor(path: PathShape, nodeId: string, ring: number, language: Lang) {
  const rng = mulberry32(hash(nodeId));
  const skill = composeSkill(rng, {
    id: `node_${nodeId}`,
    name: '',
    description: '',
    ability: path.primary,
    grammar: STAT_GRAMMAR[path.primary],
    // Deeper nodes are richer, the same way a deeper book is.
    budget: budgetForFloor(ring * 2),
    language,
  });
  return skill;
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
  path: PathShape,
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
      id: `${path.id}_${suffix}`,
      name: '',
      description: '',
      kind,
      path: path.id,
      stat: path.primary,
      ring,
      x: pos.x,
      y: pos.y,
      connections: parents,
      grant: {},
    };

    const words = PATH_WORDS[path.primary];

    if (kind === 'keystone') {
      const trade = keystoneTradeFor(path.primary);
      node.name = words.keystone;
      node.description = describe(trade.grant, trade.cost, language);
      node.grant = trade.grant;
      node.cost = trade.cost;
      node.requires = [{ kind: 'level', atLeast: 5 + Math.floor(rng() * 4) }];
    } else if (kind === 'notable') {
      const which = (taught === 0 ? 0 : 1) as 0 | 1;
      node.name = words.notables[which];
      node.grant = grantForRing(path.primary, path.secondary, kind, ring, rng());
      // Composed from the stat's own grammar, so a notable can only ever teach
      // something its path is actually capable of.
      node.teaches = teachFor(path, node.id, ring, language);
      node.description = describe(node.grant, undefined, language);
      taught += 1;
    } else {
      node.name = words.minors[Math.floor(rng() * words.minors.length)];
      node.grant = grantForRing(path.primary, path.secondary, kind, ring, rng());
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
  path: PathShape,
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
    path: path.id,
    stat: path.primary,
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
    name: PATH_WORDS[path.primary].notables[index % 2],
    description: '',
    kind: 'notable',
    path: path.id,
    stat: path.primary,
    ring: 10,
    x: cx + Math.cos(angle) * 5,
    y: cy + Math.sin(angle) * 5,
    connections: [gate.id],
    grant: grantForRing(path.primary, path.secondary, 'notable', 6, rng()),
    teaches: teachFor(path, `isle${index}_heart`, 6, language),
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
  /** The resolved class, for generated rosters that no global list contains. */
  classSpec?: CharacterClass;
  /** Chosen at level 3, and paying out again at 6 and 10. */
  subclassId?: string;
  /** Drives which subclass stages have grown. */
  level?: number;
  /**
   * The character's scores, which decide which paths are open.
   *
   * Optional so a tree can still be drawn before a sheet exists — the creation
   * page previews one — but without it every path is treated as open, because
   * a preview that hid most of the tree would be worse than useless.
   */
  scores?: Record<Ability, number>;
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
  // The carried spec first. A generated class is not in any global list, so
  // resolving by id alone would silently hand a generated character the wrong
  // tree — or no tree at all.
  const held = classOf(options);
  const chosenSub = subclassOf(options);

  const rng = mulberry32(
    (seed ^ hash(backgroundId) ^ hash(backgroundName) ^ hash(options.classId ?? '')) >>> 0,
  );

  /*
   * The class decides where the tree opens. Falling back to the background
   * matcher keeps every session made before classes existed working exactly as
   * it did — a stored tree must not rearrange itself under a save.
   */
  /*
   * HOME IS THE PATH THIS CHARACTER OPENS BEST, not a class's first discipline.
   * The spread decides it, so the tree centres on what the character actually
   * is rather than on a category they picked at creation.
   */
  const world = pathsFor(seed);
  const scores = options.scores ?? null;
  const lean: Lean = { favours: held?.favours, against: held?.against };
  const openToThem = scores ? openPaths(world, scores, lean) : world.slice(0, MIN_DISCIPLINES);
  const home = (openToThem[0] ?? world[0]);
  const nodes: SkillNode[] = [];

  const start: SkillNode = {
    id: 'start',
    name: language === 'th' ? 'จุดเริ่ม' : 'Origin',
    description: language === 'th' ? 'จุดที่ทุกอย่างเริ่มต้น' : 'Where everything starts.',
    kind: 'minor',
    path: home.id,
    stat: home.primary,
    ring: 0,
    x: 50,
    y: 50,
    connections: [],
    grant: {},
  };
  nodes.push(start);

  /*
   * Every path the world has, not only the ones open now. A sealed one is on
   * the tree with its stat gate on it, so raising a score unseals a branch
   * that was visibly waiting rather than conjuring one from nowhere.
   */
  const chosen = world;
  const shapes = new Map<string, Shape>();

  chosen.forEach((path, index) => {
    // Angles are spread but not even — a perfectly regular fan reads as a wheel.
    const base = (index / chosen.length) * Math.PI * 2 - Math.PI / 2;
    const angle = base + (rng() - 0.5) * 0.5;
    const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
    shapes.set(path.id, shape);

    /*
     * A path the spread does not open is SEALED rather than absent: its nodes
     * carry the stat gate, and `requires` already hides anything unmet. Being
     * able to see what you have not earned is the point — a threshold is a
     * goal, and goals may be shown.
     */
    const gate = scores && !isOpen(path, scores, lean)
      ? [{ kind: 'ability' as const, ability: path.primary, atLeast: gateFor(path, lean) }]
      : undefined;

    for (const { node } of growBranch(rng, path, shape, angle, language, start.id)) {
      nodes.push(gate ? { ...node, requires: [...(node.requires ?? []), ...gate] } : node);
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

      const from = nodes.filter((n) => n.path === here.id && n.ring >= 2 && n.ring <= 5);
      const to = nodes.filter((n) => n.path === there.id && n.ring >= 2 && n.ring <= 5);
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
    const tips = nodes.filter((n) => n.path === host.id && n.ring >= 3);
    if (tips.length === 0) continue;
    const anchor = tips[Math.floor(rng() * tips.length)];

    /*
     * An island belongs to a path the spread has NOT opened — the reward for
     * playing a certain way is a door into something your scores do not yet
     * justify, which is the only way to reach one without raising the stat.
     */
    const sealed = scores ? world.filter((p) => !isOpen(p, scores, lean)) : world;
    const foreign = (sealed.length ? sealed : world)[Math.floor(rng() * (sealed.length || world.length))];
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

  /*
   * The SAME catalogue the fold awarded from. A tree that built its own would
   * quietly fail to grow the branch of any trait the character's class,
   * subclass or background topped the list up with — the trait would sit in
   * the panel with a branch it had been promised and nowhere for it to be.
   */
  const catalogue = traitsFor(seed, {
    classId: options.classId,
    subclassId: options.subclassId,
    background: backgroundName,
    language,
  });

  /*
   * THE CAP, and it is the one real risk in the whole generated design.
   *
   * Declared sources are bounded — a world offers a dozen traits, a character
   * holds a handful of Signets, a class has three subclass stages. Emergent
   * ones are not: a long run drives every counter, every shape that comes true
   * mints a trait, and every trait would grow a branch. The tree sprawls into
   * noise and a legible web stops being legible.
   *
   * So only the first few grow anything. Taken in EARN ORDER, which is why
   * this reads the unsorted list — `sheet.traits` appends, so the order is the
   * order they arrived, and it survives a replay. The sorted walk below is for
   * a stable layout and would have thrown that away.
   */
  const grownEmergent = new Set(
    (options.traits ?? []).filter(isEmergent).slice(0, EMERGENT_BRANCH_CAP),
  );

  for (const traitId of [...(options.traits ?? [])].sort()) {
    const trait = catalogue.find((t) => t.id === traitId);
    if (!trait?.opens) continue;
    if (isEmergent(traitId) && !grownEmergent.has(traitId)) continue;
    attach(`trait_${trait.id}`, trait.opens, { kind: 'trait', id: trait.id, name: trait.name });
  }

  // This world's Signets, for the same reason as the traits above: the
  // authored list stopped being what a world hides once they were generated,
  // and a branch looked up in the wrong list simply never grows.
  const hidden = candidateSignetsFor(seed, catalogue);

  for (const signetId of [...(options.signets ?? [])].sort()) {
    const signet = hidden.find((x) => x.id === signetId);
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
        { stat: chosenSub.opens, entry: shape.entry, size: shape.size, needs: shape.needs },
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
    home: home.id,
    paths: chosen.map((p) => p.id),
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

