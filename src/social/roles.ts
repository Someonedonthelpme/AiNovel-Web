import { mulberry32 } from '../engine/roll.ts';
import { EDGE_AXES, edgeKey, nudgeAll } from './edge.ts';
import type { EdgeAxis, Edges } from './edge.ts';

/**
 * What two people ARE to each other.
 *
 * Not a symmetric label. A relation has two ends and they are different ends —
 * "father" and "child" are one relationship seen from two sides, and a single
 * word for it can only ever describe one of them. So a role is a PAIR, and an
 * edge stores which end of the pair this direction holds.
 *
 * THE PAIR IS THE UNIT, and that is what makes the converse structural rather
 * than a table somebody has to keep in step. `converseOf` flips a character; a
 * role whose opposite does not exist is not expressible, so it cannot happen.
 *
 * THE WORLD GENERATES ITS ROLES, because a fixed list cannot say two things it
 * needs to. A matrilineal world inherits through the mother's brother — the
 * right word for that is "uncle" and the SHAPE is wrong, because inheritance
 * flows the other way. And oath-siblings are kin obligation between people who
 * are not kin, which degrades to "friend" without a slot of its own.
 *
 * It is made safe the way everything generated here is made safe: THE MECHANICS
 * ARE AUTHORED AND THE WORDS ARE NOT. A template declares what is owed, what is
 * allowed and what the axes open at, all from closed lists the engine actually
 * checks. The model supplies two nouns. It can invent a word for a thing; it
 * can never invent an obligation that nothing enforces.
 *
 * `lifecycle` — what creates a role and what ends it — is deliberately absent.
 * Nothing creates or ends one at runtime yet; betrayal and payment arrive with
 * the deed system, and the field arrives with them rather than sitting here
 * unread. Same rule as the four edge axes held back in `edge.ts`.
 */

/* -------------------------------------------------------------------------- */
/* The closed vocabularies                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What one end owes the other.
 *
 * Closed, because "who inherits?" has to be answerable by the engine without
 * it knowing the word for uncle. A generated matrilineal role says
 * `inheritance` flows from A to B, and the question resolves.
 */
export const OBLIGATIONS = [
  'obedience', 'support', 'coin', 'secrecy', 'inheritance', 'protection', 'shelter',
] as const;
export type Obligation = (typeof OBLIGATIONS)[number];

/**
 * What a role allows that a stranger may not.
 *
 * This matters more than it looks: a relationship changes WHICH ACTIONS ARE
 * OFFERED, not merely the numbers on them. Being someone's captain is being
 * able to give them an order at all.
 */
export const PERMISSIONS = ['command', 'enter', 'borrow', 'alone', 'speakFor'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The archetypal shapes a bond takes. Authored; the words are not. */
export const ROLE_KINDS = [
  'kin', 'bonded', 'power', 'exchange', 'sworn', 'lifeDebt',
  'feud', 'custodial', 'made', 'professional', 'host',
] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

type Axes = Partial<Record<EdgeAxis, number>>;

type Template = {
  /** Fallback words for end A and end B, until the world names them. */
  words: [string, string];
  /** What A owes B. */
  owes: Obligation[];
  /** What B owes A. Directional by construction; nothing has to stay in step. */
  owed: Obligation[];
  /** What A may do that a stranger may not, and what B may. */
  permits: [Permission[], Permission[]];
  /** What the edges open at, A→B then B→A. */
  opens: [Axes, Axes];
};

/**
 * The templates.
 *
 * Every one of these is mechanically DISTINCT — a duplicate would be a role
 * that adds a word to the world and nothing to how it plays, and `roles.test.ts`
 * proves no two share a shape.
 */
const TEMPLATES: Record<RoleKind, Template> = {
  /** Elder and younger. The one that has to carry inheritance in either direction. */
  kin: {
    words: ['elder kin', 'younger kin'],
    owes: ['shelter', 'inheritance', 'protection'],
    owed: ['obedience', 'support'],
    permits: [['command', 'enter'], ['enter']],
    opens: [{ trust: 2, familiarity: 3 }, { trust: 2, familiarity: 3, respect: 1 }],
  },
  /** Married, partnered, sworn to one household. Symmetric and total. */
  bonded: {
    words: ['spouse', 'spouse'],
    owes: ['support', 'secrecy', 'shelter'],
    owed: ['support', 'secrecy', 'shelter'],
    permits: [['enter', 'alone', 'speakFor', 'borrow'], ['enter', 'alone', 'speakFor', 'borrow']],
    opens: [{ trust: 3, familiarity: 4 }, { trust: 3, familiarity: 4 }],
  },
  /** Master and servant. Obedience one way, keep one way. */
  power: {
    words: ['master', 'servant'],
    owes: ['shelter', 'coin'],
    owed: ['obedience'],
    permits: [['command', 'enter'], []],
    opens: [{ familiarity: 2 }, { familiarity: 2, fear: 1, respect: 1 }],
  },
  /** Creditor and debtor. The one that ends by being settled. */
  exchange: {
    words: ['creditor', 'debtor'],
    owes: [],
    owed: ['coin'],
    permits: [[], []],
    opens: [{ familiarity: 1 }, { familiarity: 1, resentment: 1 }],
  },
  /** Oath-siblings: kin obligation between people who are not kin. */
  sworn: {
    words: ['oath-brother', 'oath-brother'],
    owes: ['support', 'protection', 'secrecy'],
    owed: ['support', 'protection', 'secrecy'],
    permits: [['enter', 'borrow', 'speakFor'], ['enter', 'borrow', 'speakFor']],
    opens: [{ trust: 3, respect: 2, familiarity: 2 }, { trust: 3, respect: 2, familiarity: 2 }],
  },
  /** One of them is alive because of the other, and both know it. */
  lifeDebt: {
    words: ['saviour', 'the spared'],
    owes: [],
    owed: ['protection', 'obedience'],
    permits: [['command'], []],
    opens: [{ regard: 1, familiarity: 1 }, { trust: 2, respect: 3, familiarity: 1 }],
  },
  /** A quarrel with blood in it. The only template that opens hostile. */
  feud: {
    words: ['enemy', 'enemy'],
    owes: [],
    owed: [],
    permits: [[], []],
    opens: [{ trust: -3, resentment: 3, fear: 1 }, { trust: -3, resentment: 3, fear: 1 }],
  },
  /** Carer and charge — the one that sits on the needs system. */
  custodial: {
    words: ['keeper', 'the kept'],
    owes: ['protection', 'shelter'],
    owed: ['obedience'],
    permits: [['command', 'enter', 'alone'], []],
    opens: [{ regard: 2, familiarity: 3 }, { trust: 3, familiarity: 3 }],
  },
  /** Summoner and summoned, maker and made. Loyalty through the same machinery. */
  made: {
    words: ['maker', 'the made'],
    owes: ['shelter'],
    owed: ['obedience', 'protection'],
    permits: [['command', 'borrow'], []],
    opens: [{ familiarity: 2 }, { trust: 2, respect: 3, fear: 1 }],
  },
  /** Patron and craftsman: work one way, coin the other. */
  professional: {
    words: ['patron', 'craftsman'],
    owes: ['coin'],
    owed: ['support'],
    permits: [['borrow'], ['enter']],
    opens: [{ familiarity: 2, regard: 1 }, { familiarity: 2, respect: 1 }],
  },
  /** Host and guest. Shelter offered, discretion expected. */
  host: {
    words: ['host', 'guest'],
    owes: ['shelter', 'protection'],
    owed: ['secrecy'],
    permits: [['command'], ['enter']],
    opens: [{ familiarity: 1, regard: 1 }, { trust: 1, familiarity: 1, respect: 1 }],
  },
};

/* -------------------------------------------------------------------------- */
/* A world's roles                                                             */
/* -------------------------------------------------------------------------- */

export type RoleId = string;

export type Role = {
  id: RoleId;
  kind: RoleKind;
  /** What this world calls the two ends. Fallbacks until the model names them. */
  names: [string, string];
};

export const MIN_ROLES = 6;
export const MAX_ROLES = 9;

/**
 * This world's roles.
 *
 * Dealt from a shuffled deck rather than drawn, so a world uses every shape it
 * has before repeating one — the same fix duplicate Signets, duplicate class
 * roles and duplicate subjects all needed.
 */
export function rolesFor(seed: number): Role[] {
  const rng = mulberry32((seed ^ 0x0b0d) >>> 0);
  const want = MIN_ROLES + Math.floor(rng() * (MAX_ROLES - MIN_ROLES + 1));
  const deck = [...ROLE_KINDS].sort(() => rng() - 0.5);

  return deck.slice(0, want).map((kind, i) => ({
    id: `role_${i}`,
    kind,
    names: [...TEMPLATES[kind].words] as [string, string],
  }));
}

/** This world's roles, named if they have been named. Mirrors `subjectsOf`. */
export const rolesOf = (world: { seed: number; roles?: Role[] }): Role[] =>
  world.roles ?? rolesFor(world.seed);

export const roleById = (roles: readonly Role[], id: RoleId): Role | null =>
  roles.find((r) => r.id === id) ?? null;

/* -------------------------------------------------------------------------- */
/* Holding one end of it                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which end of a pair somebody holds, as `role_3/a` or `role_3/b`.
 *
 * One string rather than an id plus a side, so an edge's `roles` list stays a
 * plain array of strings and the converse is a character flip. A reference
 * whose opposite does not exist cannot be written down.
 */
export type RoleRef = string;

export const refFor = (id: RoleId, end: 'a' | 'b'): RoleRef => `${id}/${end}`;

export const converseOf = (ref: RoleRef): RoleRef =>
  ref.endsWith('/a') ? `${ref.slice(0, -2)}/b` : `${ref.slice(0, -2)}/a`;

export const idOfRef = (ref: RoleRef): RoleId => ref.slice(0, -2);
export const endOfRef = (ref: RoleRef): 'a' | 'b' => (ref.endsWith('/a') ? 'a' : 'b');

/** What this world calls the end somebody is holding. */
export function nameOfRef(roles: readonly Role[], ref: RoleRef): string | null {
  const role = roleById(roles, idOfRef(ref));
  return role ? role.names[endOfRef(ref) === 'a' ? 0 : 1] : null;
}

/* -------------------------------------------------------------------------- */
/* Forming one                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Put two people into a relationship, BOTH WAYS.
 *
 * The converse is written at the same moment as the role, which is the whole
 * reason the pair is the unit — an edge saying "she is my daughter" while the
 * other direction says nothing is not a half-built relationship, it is a bug
 * that reads as one.
 *
 * The defaults are applied on the way in: a father edge opens high on trust
 * and familiarity, an enemy edge opens hostile. That is what makes a generated
 * bond mean something the moment it exists rather than after enough turns.
 */
export function formRole(edges: Edges | undefined, roles: readonly Role[], a: string, b: string, ref: RoleRef): Edges {
  const role = roleById(roles, idOfRef(ref));
  if (!role || a === b) return edges ?? {};

  const template = TEMPLATES[role.kind];
  const mine = endOfRef(ref) === 'a' ? 0 : 1;

  let next = nudgeAll(edges, a, b, template.opens[mine]);
  next = nudgeAll(next, b, a, template.opens[1 - mine]);

  return {
    ...next,
    [edgeKey(a, b)]: withRole(next[edgeKey(a, b)] ?? { from: a, to: b, axes: {} }, ref),
    [edgeKey(b, a)]: withRole(next[edgeKey(b, a)] ?? { from: b, to: a, axes: {} }, converseOf(ref)),
  };
}

const withRole = (edge: { from: string; to: string; axes: Axes; roles?: string[] }, ref: RoleRef) =>
  ({ ...edge, roles: [...new Set([...(edge.roles ?? []), ref])] });

/* -------------------------------------------------------------------------- */
/* Asking what a relationship means                                            */
/* -------------------------------------------------------------------------- */

const templateFor = (roles: readonly Role[], ref: RoleRef): Template | null => {
  const role = roleById(roles, idOfRef(ref));
  return role ? TEMPLATES[role.kind] : null;
};

/**
 * What `from` owes `to`, across every role they hold together.
 *
 * The question the generated-roles design exists to answer. A matrilineal world
 * emits a role whose A end owes `inheritance`, and this resolves "who inherits
 * from whom" without the engine ever knowing the word for uncle.
 */
export function owedBy(edges: Edges | undefined, roles: readonly Role[], from: string, to: string): Obligation[] {
  const held = edges?.[edgeKey(from, to)]?.roles ?? [];
  const out = new Set<Obligation>();

  for (const ref of held) {
    const template = templateFor(roles, ref);
    if (!template) continue;
    // `owes` is always what the A end owes, so the B end reads the other list.
    for (const o of endOfRef(ref) === 'a' ? template.owes : template.owed) out.add(o);
  }
  return [...out];
}

/** Everyone who owes `who` an inheritance — the query a fixed role list fails. */
export const heirsOf = (edges: Edges | undefined, roles: readonly Role[], who: string): string[] =>
  Object.values(edges ?? {})
    .filter((e) => e.from === who && owedBy(edges, roles, who, e.to).includes('inheritance'))
    .map((e) => e.to);

/**
 * What `from` may do to `to` that a stranger may not.
 *
 * A relationship changes which actions are OFFERED, and this is the read that
 * makes that true — the Director is told what a bond allows, so being somebody's
 * captain means being able to give them an order at all.
 */
export function permittedBy(edges: Edges | undefined, roles: readonly Role[], from: string, to: string): Permission[] {
  const held = edges?.[edgeKey(from, to)]?.roles ?? [];
  const out = new Set<Permission>();

  for (const ref of held) {
    const template = templateFor(roles, ref);
    if (!template) continue;
    for (const p of template.permits[endOfRef(ref) === 'a' ? 0 : 1]) out.add(p);
  }
  return [...out];
}

/** Every role two people hold together, in this world's words. */
export const rolesHeld = (edges: Edges | undefined, roles: readonly Role[], from: string, to: string): string[] =>
  (edges?.[edgeKey(from, to)]?.roles ?? [])
    .map((ref) => nameOfRef(roles, ref))
    .filter((n): n is string => n !== null);

/** The axes a template opens at, exposed so tests can prove the defaults land. */
export const opensAt = (roles: readonly Role[], ref: RoleRef): Axes => {
  const template = templateFor(roles, ref);
  if (!template) return {};
  return template.opens[endOfRef(ref) === 'a' ? 0 : 1];
};

/** Every axis any template ever opens — the writer proof reads this. */
export const axesTemplatesOpen = (): EdgeAxis[] =>
  EDGE_AXES.filter((axis) =>
    Object.values(TEMPLATES).some((t) => t.opens.some((o) => (o[axis] ?? 0) !== 0)));

/** The shape of a template, for the no-two-alike proof. */
export const shapeOfKind = (kind: RoleKind): string => {
  const t = TEMPLATES[kind];
  return JSON.stringify([
    [...t.owes].sort(), [...t.owed].sort(),
    [...t.permits[0]].sort(), [...t.permits[1]].sort(),
  ]);
};
