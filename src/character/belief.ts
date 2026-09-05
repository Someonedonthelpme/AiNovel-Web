import { mulberry32 } from '../engine/roll.ts';

/**
 * What somebody holds true, as distinct from what IS true.
 *
 * The distinction the design was eliding. Knowledge PROPAGATING is a true fact
 * reaching more people, and `tell` already does a hop of that. A RUMOUR is a
 * claim that may be false, that distorts as it travels, and that people hold
 * with different confidence. Those need a belief, not a set of known ids.
 *
 * The arc this exists for, which is the user's own example:
 *
 *   she believes she cannot leave the floor      a TRUE belief
 *   a rumour says people like her can            she holds it — and it is FALSE
 *   she acts on it                               goes to the stair
 *   reality contradicts her                      the belief is CORRECTED
 *   she learns she was lied to                   the teller's credibility falls
 *
 * Somebody acting on something wrong is where most story comes from, and none
 * of it is expressible while "knowledge" is a list of ids you either have or
 * do not. It also finally gives `candour` and lying something to bear on.
 *
 * Lives in `character/` rather than `play/` because a `Persona` holds beliefs,
 * and a persona may not import upward. Person ids are plain strings here for
 * the same reason.
 */

/**
 * The things that can be believed.
 *
 * A closed union, like every other vocabulary the engine resolves. A model may
 * say what a rumour is ABOUT; it never invents a kind of claim.
 */
export type Claim =
  /** A history, a story, a song — see `play/lore.ts`. */
  | { kind: 'lore'; id: string }
  /** A world rule: "people like me cannot cross floors". */
  | { kind: 'rule'; rule: string }
  /** Somebody did something. */
  | { kind: 'deed'; who: string; what: string }
  /** Two people stand in some relation. The one most worth lying about. */
  | { kind: 'bond'; a: string; b: string; role: string };

/** Stable and order-independent, so a bond reads the same from either end. */
export function claimKey(claim: Claim): string {
  switch (claim.kind) {
    case 'lore': return `lore:${claim.id}`;
    case 'rule': return `rule:${claim.rule}`;
    case 'deed': return `deed:${claim.who}:${claim.what}`;
    case 'bond': {
      const [x, y] = [claim.a, claim.b].sort();
      return `bond:${x}:${y}:${claim.role}`;
    }
  }
}

export type Belief = {
  claim: Claim;
  /**
   * Whether they think it is SO.
   *
   * A belief can be that something is not the case — which is what makes the
   * shopkeeper's "I cannot leave" a belief rather than an absence of one, and
   * therefore something a rumour can overturn.
   */
  holds: boolean;
  /** How sure, 0..1. Falls with every retelling. */
  confidence: number;
  /** Who told them, so a lie can be traced back to its source. */
  from: string | null;
  /** How many hands it passed through. */
  drift: number;
};

/**
 * How sure somebody is, in the words a model can write to.
 *
 * `confidence` scaled an edge nudge once and was then consulted by nothing, so
 * an NPC who SAW you do it and one who half-heard about it were, to everyone
 * downstream, holding the same thing. The difference between those two is most
 * of what a rumour system is for, and it has to be sayable.
 */
export function certaintyOf(belief: Belief): string {
  if (belief.drift === 0) return 'saw it themselves';
  if (belief.confidence >= 0.7) return 'was told by someone who was there';
  if (belief.confidence >= 0.5) return 'has heard it, and believes it';
  if (belief.confidence >= 0.3) return 'has heard something like it';
  return 'half-remembers a story about it';
}

export const FIRSTHAND = 1;
/** Each retelling costs this much certainty. */
export const HOP_COST = 0.15;
/** Past this much drift, nobody remembers who said it. */
export const SOURCE_LOST_AT = 3;
/** Past this, the story can come back inverted. */
export const INVERTS_AT = 5;

export const firsthand = (claim: Claim, holds = true): Belief =>
  ({ claim, holds, confidence: FIRSTHAND, from: null, drift: 0 });

/* -------------------------------------------------------------------------- */
/* Holding one                                                                 */
/* -------------------------------------------------------------------------- */

export const beliefAbout = (beliefs: readonly Belief[], claim: Claim): Belief | null =>
  beliefs.find((b) => claimKey(b.claim) === claimKey(claim)) ?? null;

/** Whether they have an opinion at all — true or false. */
export const hasOpinion = (beliefs: readonly Belief[], claim: Claim): boolean =>
  beliefAbout(beliefs, claim) !== null;

/** Whether they hold it as SO. Absent and disbelieved both answer no. */
export const believes = (beliefs: readonly Belief[], claim: Claim): boolean =>
  beliefAbout(beliefs, claim)?.holds === true;

/**
 * Take on a belief.
 *
 * A more confident account displaces a weaker one; a weaker one is ignored.
 * That is what stops a rumour heard fifth-hand from overturning what somebody
 * saw with their own eyes — and it is why `confidence` has to travel with the
 * claim rather than being recomputed at the destination.
 */
export function adopt(beliefs: readonly Belief[], belief: Belief): Belief[] {
  const held = beliefAbout(beliefs, belief.claim);
  if (held && held.confidence >= belief.confidence) return [...beliefs];
  return [...beliefs.filter((b) => claimKey(b.claim) !== claimKey(belief.claim)), belief];
}

/* -------------------------------------------------------------------------- */
/* Passing it on                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a belief becomes in somebody else's mouth.
 *
 * Deterministic — seeded from the claim, the teller and the hop — so it needs
 * no model call and replays exactly. Three things happen as a story travels,
 * in the order they happen in life: it loses certainty, then it loses its
 * source, and eventually it can come back meaning the opposite.
 *
 * Hearing your own deed return to you wrong is the most memorable thing this
 * system can produce, and it costs a hash.
 *
 * `ponytail: no person-swapping yet — "it was the other brother" needs a pool
 * of plausible substitutes, which arrives with the social graph. Drift, source
 * loss and inversion carry it until then.`
 */
export function retell(belief: Belief, teller: string): Belief {
  const drift = belief.drift + 1;
  const rng = mulberry32(hash(`${claimKey(belief.claim)}|${teller}|${drift}`));

  const confidence = Math.max(0.05, belief.confidence - HOP_COST);
  const from = drift >= SOURCE_LOST_AT ? null : teller;
  // Inversion is rare even once it is possible; a story that flipped every
  // time it was far enough travelled would be noise rather than rumour.
  const flips = drift >= INVERTS_AT && rng() < 0.25;

  return { claim: belief.claim, holds: flips ? !belief.holds : belief.holds, confidence, from, drift };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Meeting reality                                                             */
/* -------------------------------------------------------------------------- */

export type Confrontation = {
  beliefs: Belief[];
  /** Whether what they held actually changed. */
  corrected: boolean;
  /**
   * Who told them the wrong thing, if anybody did.
   *
   * The reason `from` is carried at all: being wrong is one thing, and finding
   * out you were wrong BECAUSE SOMEBODY TOLD YOU SO is another. This is what
   * the trust damage lands on.
   */
  misledBy: string | null;
};

/**
 * Reality contradicts, or confirms.
 *
 * Firsthand contact settles it: what you see yourself is held with full
 * confidence and no source, so nothing second-hand can talk you out of it
 * afterwards.
 */
export function confront(beliefs: readonly Belief[], claim: Claim, truth: boolean): Confrontation {
  const held = beliefAbout(beliefs, claim);
  const settled = firsthand(claim, truth);
  const next = adopt(beliefs.filter((b) => claimKey(b.claim) !== claimKey(claim)), settled);

  if (!held) return { beliefs: next, corrected: false, misledBy: null };
  if (held.holds === truth) return { beliefs: next, corrected: false, misledBy: null };

  return { beliefs: next, corrected: true, misledBy: held.from };
}
