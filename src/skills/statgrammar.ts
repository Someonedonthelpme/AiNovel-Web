import { ABILITIES } from '../combat/types.ts';
import type { Ability } from '../combat/types.ts';
import type { Grammar } from './compose.ts';

/**
 * What each STAT is able to do.
 *
 * The single most important file in the move off disciplines, because it
 * inherits the job the discipline grammar was doing — and coherence, not
 * balance, is the hard half of generation. A composer with a budget and no
 * grammar cheerfully produces a bow that heals: legal, correctly priced, and
 * reading as a bug. Discipline grammar was the only thing preventing that, and
 * disciplines are going away.
 *
 * A STAT CARRIES IT BETTER, for two reasons.
 *
 * It is SETTING-AGNOSTIC. `magic`, `blackMagic` and `flame` are nonsense in a
 * world of rusted freeways, and they were the last hardcoded-fantasy thing in a
 * game that generates everything else. INT's `burst` is a fireball in a kingdom
 * and a breaching charge in a wreck; the mechanics are identical and only the
 * words change.
 *
 * And it expresses something disciplines could not: THE SAME PAYLOAD FROM A
 * DIFFERENT STAT IS A DIFFERENT THING. `bow` owned strike and `guard` owned
 * mend and that was the end of it. Now:
 *
 *   hinder on STR  you pin them          grappled, prone   reach 1
 *   hinder on DEX  you cripple them      restrained        reach 8
 *   hinder on WIS  you misdirect them    blinded           reach 4
 *   hinder on CHA  you get under         frightened        reach 6
 *                  their skin
 *
 * One payload, four genuinely different skills, chosen by the build rather than
 * by a category somebody authored.
 *
 * `Grammar` is reused unchanged from compose.ts, so `composeSkill` needs no
 * edit at all — it asks for a grammar and does not care where one came from.
 */

export const STAT_GRAMMAR: Record<Ability, Grammar> = {
  /** Force applied directly. Nothing at range, because you have to reach it. */
  str: {
    payloads: ['strike', 'hinder', 'burst'],
    conditions: ['grappled', 'prone'],
    maxRange: 1,
  },
  /** The steady hand: it hits, from anywhere, and it hits where it meant to. */
  dex: {
    payloads: ['strike', 'hinder', 'special'],
    conditions: ['restrained', 'blinded'],
    // Breaking a wind-up is timing, and timing is the steady hand's whole job.
    verbs: ['interrupt'],
    maxRange: 8,
  },
  /**
   * The mind holding on. Turned inward by design — CON keeps YOU going and
   * never reaches out to touch anybody.
   *
   * THE CON/VIT LINE IS REACH, not whether it heals — and that is a correction.
   * Stripping `mend` off CON entirely read well and played badly: `rally` and
   * `edge` are both flat-priced, so CON spent 30% of a deep budget against
   * 64-87% everywhere else, which would make the deep nodes of a CON path
   * worthless. Measured, not guessed.
   *
   * So CON mends at RANGE 0 and VIT mends at range 1. CON is pushing through
   * something that should have dropped you — second wind, and only ever your
   * own. Reaching over to put somebody else back together is a body's work,
   * and bodies are VIT. What CON still does not do is grant maximum hit
   * points; recovering some of yours and having more of them are different
   * claims, and only the second one was VIT's to keep.
   */
  con: {
    payloads: ['mend', 'rally', 'edge', 'special'],
    conditions: ['poisoned', 'stunned'],
    // Shrugging off everything at once is what pushing through IS.
    verbs: ['cleanse'],
    maxRange: 0,
  },
  /** Speed. Quick strikes, and putting somebody on the floor as you pass. */
  agi: {
    payloads: ['strike', 'hinder', 'edge'],
    conditions: ['prone'],
    maxRange: 2,
  },
  /** The body: keeping yours upright and putting somebody else back together. */
  vit: {
    payloads: ['mend', 'rally', 'edge'],
    conditions: ['prone'],
    maxRange: 1,
  },
  /**
   * Worked power — figures in a kingdom, electronics in a wreck.
   *
   * The widest payload list and the longest reach, which is what makes INT the
   * stat that a character with none of it genuinely cannot substitute for.
   */
  int: {
    payloads: ['burst', 'hex', 'strike', 'edge'],
    conditions: ['blinded', 'stunned'],
    maxRange: 8,
  },
  /** Seeing it coming, and making sure somebody else does not. */
  wis: {
    payloads: ['mend', 'hinder', 'rally', 'edge'],
    conditions: ['blinded'],
    maxRange: 4,
  },
  /** Getting under someone's skin, or getting people to hold the line. */
  cha: {
    payloads: ['rally', 'hinder', 'drain', 'edge', 'special'],
    conditions: ['frightened'],
    // Making yourself the only thing worth looking at. Nothing else in the
    // game takes somebody's CHOICE away, which is what CHA should be for.
    verbs: ['taunt'],
    maxRange: 6,
  },
  /** Things going your way. Thin on payloads, because luck is not a technique. */
  luk: {
    payloads: ['drain', 'hex', 'edge'],
    conditions: ['poisoned'],
    maxRange: 4,
  },
};

export const grammarFor = (stat: Ability): Grammar => STAT_GRAMMAR[stat];

/**
 * Every stat can be built from, and no stat can build everything.
 *
 * Both halves matter. A stat with an empty payload list would be a dead axis —
 * points into it could never buy a skill. A stat with every payload there is
 * would make the others decorative, and the grammar would stop constraining
 * anything.
 */
export const STATS_WITH_GRAMMAR = ABILITIES;
