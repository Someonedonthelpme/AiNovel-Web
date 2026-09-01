import type { Ability, Abilities } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { ARCHETYPES, archetypeForBackground, skillFrom } from './archetypes.ts';
import type { Archetype, ArchetypeId } from './archetypes.ts';
import type { TraitCondition } from './traits.ts';

/**
 * The passive tree.
 *
 * Path of Exile-shaped: one large web, entered where your background puts you,
 * where a point may only be spent on a node ADJACENT to one you already hold.
 * Contiguity is the whole mechanic — a distant node means paying for the route,
 * so a build is the path you took rather than a shopping list.
 *
 * Eight DISCIPLINES radiate from the centre — sword, bow, shield, the long
 * look, figures, the cost, the quiet word, the long walk — and they are not
 * interchangeable spokes. Each leans on its own abilities, and each TEACHES two
 * active skills at its notables, so walking a branch changes what you can do
 * and not only what your numbers are. That was the thing missing: a tree of
 * nothing but "+1 str" says nothing about who you are becoming.
 *
 * The disciplines are authored; the LAYOUT is generated per seed, so no two
 * characters walk quite the same map. Cross-links between neighbours let a
 * build hybridise rather than committing to one spoke forever.
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
};

export type SkillTree = {
  id: string;
  start: string;
  /** Which discipline the character opens next to. */
  home: ArchetypeId;
  nodes: SkillNode[];
};

export type Lang = 'th' | 'en';

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/** Six rings: two minors, a notable, a minor, a second notable, a keystone. */
export const RINGS = 6;
const NOTABLE_RINGS = new Set([3, 5]);
const KEYSTONE_RING = 6;

/** Where cross-links between neighbouring disciplines are allowed to form. */
const CROSSING_RINGS = [2, 4];

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

export function skillTreeFor(seed: number, backgroundId: string, language: Lang = 'en'): SkillTree {
  const rng = mulberry32((seed ^ hash(backgroundId)) >>> 0);
  const home = archetypeForBackground(backgroundId);
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

  // The character's own discipline faces outward first, so the branch they were
  // trained for is the one under their hand when the tree opens.
  const ordered = [...ARCHETYPES].sort((a, b) => (a.id === home ? -1 : b.id === home ? 1 : 0));

  ordered.forEach((archetype, index) => {
    const angle = (index / ordered.length) * Math.PI * 2 - Math.PI / 2 + rng() * 0.12;
    let previous = start.id;
    let notablesPlaced = 0;

    for (let ring = 1; ring <= RINGS; ring++) {
      const kind: NodeKind = ring === KEYSTONE_RING ? 'keystone' : NOTABLE_RINGS.has(ring) ? 'notable' : 'minor';
      const radius = ring * 7.6;
      const wobble = (rng() - 0.5) * 0.14;

      const node: SkillNode = {
        id: nodeId(archetype.id, ring),
        name: '',
        description: '',
        kind,
        archetype: archetype.id,
        ring,
        x: 50 + Math.cos(angle + wobble) * radius,
        y: 50 + Math.sin(angle + wobble) * radius,
        connections: [previous],
        grant: {},
      };

      if (kind === 'keystone') {
        const trade = keystoneTrade(archetype);
        node.name = archetype.keystone[language];
        node.description = archetype.keystoneNote[language];
        node.grant = trade.grant;
        node.cost = trade.cost;
        // The rim opens up as the character does — the tree grows with them.
        node.requires = [{ kind: 'level', atLeast: 6 }];
      } else if (kind === 'notable') {
        const which = notablesPlaced === 0 ? 0 : 1;
        node.name = archetype.notables[which][language];
        node.grant = grantFor(archetype, kind, ring, rng());
        node.teaches = skillFrom(archetype, which as 0 | 1, language);
        node.description = describe(node.grant, undefined, language);
        notablesPlaced += 1;
      } else {
        const minor = archetype.minors[Math.min(archetype.minors.length - 1, ring <= 2 ? ring - 1 : ring - 2)];
        node.name = minor[language];
        node.grant = grantFor(archetype, kind, ring, rng());
        node.description = describe(node.grant, undefined, language);
      }

      nodes.push(node);
      previous = node.id;
    }
  });

  // Cross-links, so the tree is a web rather than eight separate ladders. Two
  // rings can bridge; whether a given pair does is down to the seed, which is
  // what stops every character seeing the same shortcuts.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let index = 0; index < ordered.length; index++) {
    const here = ordered[index];
    const next = ordered[(index + 1) % ordered.length];
    for (const ring of CROSSING_RINGS) {
      if (rng() < 0.6) byId.get(nodeId(here.id, ring))?.connections.push(nodeId(next.id, ring));
    }
  }

  return { id: `tree_${backgroundId}`, start: start.id, home, nodes: linkBothWays([...byId.values()]) };
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
