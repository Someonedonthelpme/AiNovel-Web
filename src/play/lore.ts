import { NEED_MAX, clampNeeds } from '../character/persona.ts';
import type { Persona, Temperament } from '../character/persona.ts';
import { adopt, firsthand, hasOpinion } from '../character/belief.ts';
import type { Claim } from '../character/belief.ts';
import type { SubjectId } from '../world/subjects.ts';

/**
 * Content that is ABOUT things, meeting a character who WANTS things.
 *
 * Lore began as a string the Writer might quote, which made it decoration. If
 * it can satisfy a want it becomes something else: a reason to keep a sword you
 * would otherwise sell, and a way for an item to matter for a reason its
 * numbers do not express — which loot economies almost never manage.
 *
 * ONE MECHANISM, ITEMS FIRST. An item's history is the first carrier; a story
 * an NPC tells, a song, a view from a high floor, a meal eaten with somebody
 * are the same object later. Nothing below knows what is carrying it.
 *
 * THE MATCH IS A SET INTERSECTION. Lore is about subjects; a drive names a want
 * and a fear in the same vocabulary, because both are drawn from the world's own
 * generated pool (`world/subjects.ts`). So the engine never judges whether a
 * history would move somebody — it checks whether they were talking about the
 * same thing.
 */

export type Lore = {
  id: string;
  text: string;
  /** What it is about, in this world's subject vocabulary. */
  about: SubjectId[];
  /**
   * How much of a thing it is: a passing mention or the whole story.
   * 1 is a line on a maker's mark; 3 is the account somebody spent a life on.
   */
  depth: number;
};

/** What a piece of lore did to somebody. */
export type Resonance = {
  /** Whether it touched them at all. */
  hit: boolean;
  /** Toward the drive being served. */
  purpose: number;
  /** Met only when the lore was shared with another person. */
  company: number;
  /** A deep match can move who somebody IS, slowly. */
  pressure: Partial<Temperament>;
};

export const NOTHING: Resonance = { hit: false, purpose: 0, company: 0, pressure: {} };

/** What a want is worth against what a fear is worth. */
export const WANT_WEIGHT = 2;
export const FEAR_WEIGHT = 1;
/** Depth at which a match is deep enough to push on who somebody is. */
export const MOVING_DEPTH = 3;

/**
 * What this lore means to this person.
 *
 * A want touching it is worth more than a fear touching it — but a fear still
 * counts, because a history about the thing you ran from is not nothing. It is
 * the reason you would rather not have read it, and it is still about you.
 */
export function resonanceOf(lore: Lore, who: Pick<Persona, 'drive'>): Resonance {
  const drive = who.drive;
  if (!drive) return NOTHING;

  const about = new Set(lore.about);
  const wanted = about.has(drive.want);
  const feared = about.has(drive.fear);
  if (!wanted && !feared) return NOTHING;

  const depth = Math.max(1, lore.depth);
  const weight = (wanted ? WANT_WEIGHT : 0) + (feared ? FEAR_WEIGHT : 0);

  return {
    hit: true,
    purpose: weight * depth,
    // Company is only met when somebody else was there; `tell` supplies it.
    company: 0,
    /*
     * A deep match nudges temperament rather than a need, and only a deep one.
     * Learning what you were really chasing steadies the nerve; learning the
     * truth about what you feared does the opposite. Rare and slow, which is
     * what makes it land at all — `pressure` still has to cross its threshold.
     */
    pressure: depth >= MOVING_DEPTH
      ? { nerve: wanted ? 1 : -1, feeling: wanted ? 1 : 0 }
      : {},
  };
}

/* -------------------------------------------------------------------------- */
/* Learning, and telling                                                       */
/* -------------------------------------------------------------------------- */

/** A lore id is just one kind of claim, so knowing one is holding a belief. */
export const loreClaim = (id: string): Claim => ({ kind: 'lore', id });

export const knowsLore = (who: Pick<Persona, 'beliefs'>, id: string): boolean =>
  hasOpinion(who.beliefs ?? [], loreClaim(id));

export type Learned<T> = { who: T; resonance: Resonance; wasNew: boolean };

/**
 * Learn something, once.
 *
 * One-time on purpose: a paragraph cannot be re-read for the same comfort
 * twice, and a need you can top up by re-opening a menu is not a need. What it
 * leaves behind is knowledge, which is what lets you tell it to somebody else.
 */
export function learn<T extends Persona>(who: T, lore: Lore): Learned<T> {
  if (knowsLore(who, lore.id)) return { who, resonance: NOTHING, wasNew: false };

  const resonance = resonanceOf(lore, who);
  const needs = clampNeeds({ ...who.needs, purpose: who.needs.purpose + resonance.purpose });

  const pressure = { ...who.pressure };
  for (const [axis, push] of Object.entries(resonance.pressure)) {
    pressure[axis as keyof Temperament] += push ?? 0;
  }

  return {
    who: {
      ...who,
      needs,
      pressure,
      // Read for yourself, so it is held firsthand: full confidence, no source.
      beliefs: adopt(who.beliefs ?? [], firsthand(loreClaim(lore.id))),
    },
    resonance,
    wasNew: true,
  };
}

export type Told<T> = { teller: T; listener: T; resonance: Resonance; told: boolean };

/**
 * Tell somebody something they did not know.
 *
 * Both sides gain company — being told a thing and having somebody to tell are
 * the same need met from opposite ends — and the listener gains whatever the
 * lore means to THEM, which may be nothing at all. That asymmetry is the point:
 * a history that moved you may bore the person you hand it to.
 *
 * You cannot tell what you do not know, which is what makes knowledge worth
 * carrying between people.
 */
export const SHARED_COMPANY = 2;

export function tell<T extends Persona>(teller: T, listener: T, lore: Lore): Told<T> {
  if (!knowsLore(teller, lore.id)) return { teller, listener, resonance: NOTHING, told: false };
  if (knowsLore(listener, lore.id)) return { teller, listener, resonance: NOTHING, told: false };

  const heard = learn(listener, lore);
  const met = (who: T) => ({
    ...who,
    needs: clampNeeds({ ...who.needs, company: Math.min(NEED_MAX, who.needs.company + SHARED_COMPANY) }),
  });

  return {
    teller: met(teller),
    listener: met(heard.who),
    resonance: { ...heard.resonance, company: SHARED_COMPANY },
    told: true,
  };
}

/* -------------------------------------------------------------------------- */
/* The proof                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether every drive a world can hand out has lore that could satisfy it.
 *
 * The reason the subject vocabulary is generated per world rather than written
 * as free text: because drives and lore are drawn from the SAME pool, this is
 * provable rather than hoped for. It is the same argument `admissible` makes
 * for Signets — a gate nothing can open is worse than no gate at all, and a
 * want nothing in the world speaks to is worse than no want.
 */
export function unreachableWants(
  subjects: readonly { id: SubjectId }[],
  catalogue: readonly Lore[],
): SubjectId[] {
  const spoken = new Set(catalogue.flatMap((l) => l.about));
  return subjects.map((s) => s.id).filter((id) => !spoken.has(id));
}
