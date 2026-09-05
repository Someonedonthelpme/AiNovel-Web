/**
 * What one person feels toward another.
 *
 * Until now a relationship was ONE number — `Person.trust`, NPC→player only,
 * and even that was merely a lens the voice bands were read through. There was
 * no way to say that she is fond of him and he barely knows she exists.
 *
 * THREE PROPERTIES CARRY THIS.
 *
 * DIRECTIONAL. A→B and B→A are separate edges and may disagree completely,
 * which is what makes unrequited love, a one-sided grudge and mistaken trust
 * expressible at all. The shopkeeper who loves the player needs exactly this.
 *
 * SPARSE. An edge exists only where two people have actually had something to
 * do with each other, and an axis that has never moved is not stored. A town of
 * two hundred is not forty thousand edges; it is the dozen that happened.
 *
 * EVERY AXIS HAS A WRITER. The failure mode of a rich relationship model is a
 * dozen numbers all hovering near zero because nothing ever pushes one of them
 * hard enough — which is this codebase's signature bug wearing a new hat. So an
 * axis is DECLARED ONLY ONCE SOMETHING WRITES IT, and `edge.test.ts` proves the
 * list still holds. `guilt` and `obligation` arrived exactly this way, with the
 * deeds that write them. `desire` and `envy` are still absent for want of one;
 * `loyalty` arrives with companions, and it moves off the persona when it does
 * — "devoted" was never a property of somebody on their own, which is exactly
 * why it never had a reader there.
 *
 * Person ids are plain strings, and this module imports nothing, so `world` may
 * hold edges without a cycle — the same arrangement `character/belief.ts` uses.
 */

export type EdgeAxis = (typeof EDGE_AXES)[number];

/**
 *  trust         will they take your word, and what will they say in front of you
 *  familiarity   how much of each other they have actually seen
 *  regard        what they think you are worth
 *  respect       whether you observe what is owed — the register mechanic's axis
 *  resentment    what they are holding against you, whatever they say
 *  fear          whether they would rather you were elsewhere
 *  guilt         what YOU carry for what you did to them
 *  obligation    what you owe them for what they did for you
 */
export const EDGE_AXES = [
  'trust', 'familiarity', 'regard', 'respect', 'resentment', 'fear', 'guilt', 'obligation',
] as const;

/**
 * One range for every axis, and it is the range the game already speaks in.
 *
 * `ponytail: reusing trust's asymmetric -3..+4 rather than widening to the
 * temperament scale. Widening would force retuning the voice bands, the
 * register shift in `registerTrust` and the Director's per-turn cap, for no
 * requirement any axis has yet. Widen when an axis needs the resolution.`
 */
export const EDGE_MIN = -3;
export const EDGE_MAX = 4;

export const clampEdge = (n: number): number => Math.max(EDGE_MIN, Math.min(EDGE_MAX, n));

export type Edge = {
  from: string;
  to: string;
  /** Sparse: an axis that is absent has never moved, and reads as nought. */
  axes: Partial<Record<EdgeAxis, number>>;
  /**
   * A's role toward B — father, creditor, oath-sibling.
   *
   * A SET, because your brother may also be the man you owe money to, and a
   * single label would have to pick which of those the relationship "is".
   */
  roles?: string[];
};

/** Keyed `from>to`, so the two directions are two entries and cannot be confused. */
export type Edges = Record<string, Edge>;

/** The player, as a party to a relationship. Matches the combat id. */
export const PLAYER = 'pc';

export const edgeKey = (from: string, to: string): string => `${from}>${to}`;

export const edgeBetween = (edges: Edges | undefined, from: string, to: string): Edge | null =>
  edges?.[edgeKey(from, to)] ?? null;

/** What `from` feels toward `to` on one axis. Never stored means nought. */
export const axisOf = (edges: Edges | undefined, from: string, to: string, axis: EdgeAxis): number =>
  edgeBetween(edges, from, to)?.axes[axis] ?? 0;

/** What an NPC thinks of the player, which is what most of the game asks. */
export const trustToward = (edges: Edges | undefined, who: string): number =>
  axisOf(edges, who, PLAYER, 'trust');

/**
 * Move one axis, forming the edge if these two had nothing between them.
 *
 * FORMED ON INTERACTION is the whole storage strategy: nothing pre-populates,
 * so the graph is only ever as large as the story that has actually happened.
 */
export function nudge(edges: Edges | undefined, from: string, to: string, axis: EdgeAxis, by: number): Edges {
  if (by === 0 || from === to) return edges ?? {};

  const key = edgeKey(from, to);
  const held = edges?.[key] ?? { from, to, axes: {} };
  const moved = clampEdge((held.axes[axis] ?? 0) + by);

  return { ...(edges ?? {}), [key]: { ...held, axes: { ...held.axes, [axis]: moved } } };
}

/** Several axes at once, which is what one act usually costs. */
export function nudgeAll(
  edges: Edges | undefined,
  from: string,
  to: string,
  by: Partial<Record<EdgeAxis, number>>,
): Edges {
  let next = edges ?? {};
  for (const axis of EDGE_AXES) next = nudge(next, from, to, axis, by[axis] ?? 0);
  return next;
}

/** Set A's roles toward B. The converse is `roles.ts`'s job, not this one's. */
export function setRoles(edges: Edges | undefined, from: string, to: string, roles: string[]): Edges {
  const key = edgeKey(from, to);
  const held = edges?.[key] ?? { from, to, axes: {} };
  return { ...(edges ?? {}), [key]: { ...held, roles: [...new Set(roles)] } };
}

/**
 * The edges a freshly generated cast opens with.
 *
 * A generator says what each person already thinks of the player — a warden is
 * wary before you have said a word — and that has to become an edge rather than
 * a number on the person, or the very first thing the world knows about a
 * relationship is stored in the wrong place.
 */
export const openingEdges = (base: Edges | undefined, cast: readonly { id: string; trust: number }[]): Edges =>
  cast.reduce((edges, who) => nudge(edges, who.id, PLAYER, 'trust', who.trust), base ?? {});

/** Everyone `who` has any edge toward — the graph rumour and deeds travel along. */
export const reachedBy = (edges: Edges | undefined, who: string): string[] =>
  Object.values(edges ?? {}).filter((e) => e.from === who).map((e) => e.to);

/** Everyone with an edge pointed AT `who`. Not the same set, and that is the point. */
export const regardedBy = (edges: Edges | undefined, who: string): string[] =>
  Object.values(edges ?? {}).filter((e) => e.to === who).map((e) => e.from);
