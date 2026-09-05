import type { Ability } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { EntryRule, GraftSpec } from './graft.ts';
import type { Gate, Signet } from './signet.ts';
import type { NodeGrant } from './skilltree.ts';
import { COUNTERS } from './traits.ts';
import type { Trait } from './traits.ts';

/**
 * Generating Signets.
 *
 * Four authored gates with their numbers scaled by seed is a template wearing a
 * disguise: every run hid recognisably the same four things. These are built
 * instead — terms drawn, combined, priced and named.
 *
 * THEMES ARE WHAT KEEP IT COHERENT. A gate assembled from any four terms in the
 * pool is mechanically fine and reads as noise: "forty kills AND read the
 * ledger AND discipline two" describes nobody and can be given no sensible
 * name. So each Signet draws inside ONE theme — depth, violence, patience,
 * craft, standing — whose terms belong together and whose words name the
 * result. The grammar is authored even when the combination is not.
 *
 * AND THE PROOF BECOMES LOAD-BEARING. `admissible` currently rejects nothing,
 * because the four authored gates were written to be satisfiable. Under
 * generation it is the only thing standing between the player and an
 * unsolvable mystery — a hidden Signet behind a gate this tower cannot satisfy
 * is indistinguishable from one that is merely well concealed, and the player
 * would search forever. Everything below is built to be provable, and the test
 * checks the proof rather than trusting the construction.
 */

type Bilingual = { en: string; th: string };

/** A term a theme may draw. Each maps onto a `Gate` the walk understands. */
type TermKind =
  | { kind: 'counter'; counter: string; low: number; high: number }
  | { kind: 'item'; family: string; low: number; high: number }
  | { kind: 'ability'; ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; low: number; high: number }
  | { kind: 'personality'; axis: 'warmth' | 'nerve' | 'discipline' | 'candour' | 'feeling'; over: boolean }
  | { kind: 'flag'; flag: string };

export type SignetTheme = {
  id: string;
  /** Terms that belong together, and read as one kind of person. */
  terms: TermKind[];
  /** Words the name is built from. */
  qualifiers: Bilingual[];
  nouns: Bilingual[];
  /** The stats its branch grows on. */
  stats: Ability[];
  /** A line for the hinted ones, so the world has something to drop. */
  rumour: Bilingual;
};

/**
 * Flags a gate may draw.
 *
 * Only ones something in the world is known to set. A gate on a flag nobody
 * raises is a wish, and the proof would rightly refuse it.
 */
export const GATEABLE_FLAGS = ['read_the_ledger', 'heard_the_bell', 'spared_someone'] as const;

export const THEMES: readonly SignetTheme[] = [
  {
    id: 'depth',
    terms: [
      { kind: 'counter', counter: COUNTERS.deepestFloor, low: 5, high: 14 },
      { kind: 'counter', counter: COUNTERS.floorsClimbed, low: 6, high: 18 },
      { kind: 'item', family: 'mat_', low: 4, high: 12 },
    ],
    qualifiers: [
      { en: 'Deep', th: 'ลึก' }, { en: 'Upper', th: 'เบื้องบน' }, { en: 'Thin', th: 'เบาบาง' },
    ],
    nouns: [
      { en: 'Current', th: 'กระแส' }, { en: 'Air', th: 'อากาศ' }, { en: 'Stair', th: 'บันได' },
    ],
    stats: ['wis', 'int', 'con'],
    rumour: {
      en: 'A trader mentions that the shards from the upper floors hum differently.',
      th: 'พ่อค้าคนหนึ่งบอกว่าเศษหินจากชั้นบนส่งเสียงหึ่งไม่เหมือนกัน',
    },
  },
  {
    id: 'violence',
    terms: [
      { kind: 'counter', counter: COUNTERS.kills, low: 20, high: 55 },
      { kind: 'counter', counter: COUNTERS.fightsWon, low: 8, high: 25 },
      { kind: 'item', family: 'weapon_', low: 3, high: 10 },
      { kind: 'ability', ability: 'str', low: 14, high: 18 },
    ],
    qualifiers: [
      { en: 'Quiet', th: 'เงียบ' }, { en: 'Red', th: 'แดง' }, { en: 'Certain', th: 'แน่นอน' },
    ],
    nouns: [
      { en: 'Kill', th: 'การสังหาร' }, { en: 'Hand', th: 'มือ' }, { en: 'Edge', th: 'คม' },
    ],
    stats: ['str', 'agi', 'int'],
    rumour: {
      en: 'Somebody has been counting, and they have stopped talking to you about it.',
      th: 'มีคนนับอยู่ และเขาก็เลิกพูดเรื่องนั้นกับคุณแล้ว',
    },
  },
  {
    id: 'patience',
    terms: [
      { kind: 'counter', counter: COUNTERS.shortRests, low: 12, high: 32 },
      { kind: 'counter', counter: COUNTERS.longRests, low: 4, high: 12 },
      { kind: 'personality', axis: 'discipline', over: true },
      { kind: 'ability', ability: 'con', low: 13, high: 17 },
    ],
    qualifiers: [
      { en: 'Long', th: 'ยาวนาน' }, { en: 'Slow', th: 'เชื่องช้า' }, { en: 'Still', th: 'นิ่ง' },
    ],
    nouns: [
      { en: 'Patience', th: 'ความอดทน' }, { en: 'Watch', th: 'การเฝ้า' }, { en: 'Night', th: 'ราตรี' },
    ],
    stats: ['vit', 'con', 'wis'],
    rumour: {
      en: 'The ones who last are not the ones who hurry, an old climber says.',
      th: 'คนที่อยู่รอดไม่ใช่คนที่รีบ นักปีนแก่คนหนึ่งบอกไว้',
    },
  },
  {
    id: 'craft',
    terms: [
      { kind: 'counter', counter: COUNTERS.itemsUsed, low: 14, high: 40 },
      { kind: 'ability', ability: 'int', low: 13, high: 18 },
      { kind: 'item', family: 'draught_', low: 2, high: 9 },
      { kind: 'flag', flag: 'read_the_ledger' },
    ],
    qualifiers: [
      { en: 'Measured', th: 'ตวงแล้ว' }, { en: 'Ledger', th: 'บัญชี' }, { en: 'Bitter', th: 'ขม' },
    ],
    nouns: [
      { en: 'Hand', th: 'มือ' }, { en: 'Dose', th: 'ปริมาณยา' }, { en: 'Page', th: 'หน้ากระดาษ' },
    ],
    stats: ['int'],
    rumour: {
      en: 'There is a ledger somewhere in town that nobody will talk about.',
      th: 'มีสมุดบัญชีเล่มหนึ่งในเมืองที่ไม่มีใครยอมพูดถึง',
    },
  },
  {
    id: 'standing',
    terms: [
      { kind: 'counter', counter: COUNTERS.peopleMet, low: 8, high: 24 },
      { kind: 'ability', ability: 'cha', low: 13, high: 18 },
      { kind: 'personality', axis: 'warmth', over: true },
      { kind: 'flag', flag: 'spared_someone' },
    ],
    qualifiers: [
      { en: 'Known', th: 'เป็นที่รู้จัก' }, { en: 'Open', th: 'เปิด' }, { en: 'Owed', th: 'ติดค้าง' },
    ],
    nouns: [
      { en: 'Face', th: 'ใบหน้า' }, { en: 'Word', th: 'คำพูด' }, { en: 'Debt', th: 'หนี้' },
    ],
    stats: ['cha', 'wis'],
    rumour: {
      en: 'Your name has started arriving in rooms before you do.',
      th: 'ชื่อของคุณเริ่มไปถึงห้องก่อนตัวคุณเอง',
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Building one                                                                */
/* -------------------------------------------------------------------------- */

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

const between = (rng: Rng, low: number, high: number): number =>
  low + Math.floor(rng() * Math.max(1, high - low + 1));

/**
 * Turn a theme's term into a gate the reachability walk understands.
 *
 * Every branch is built inside the limits the walk checks against — a counter
 * that has a writer, a family the tower drops, a depth it reaches, a score it
 * can be raised to. Provable by construction, and then proved anyway.
 */
function gateFor(rng: Rng, term: TermKind, horizon: number, maxAbility: number): Gate {
  switch (term.kind) {
    case 'counter':
      return {
        kind: 'condition',
        condition: { kind: 'counter', counter: term.counter, atLeast: between(rng, term.low, term.high) },
      };

    case 'item':
      return {
        kind: 'itemFromDepth',
        family: term.family,
        minFloor: Math.min(horizon, between(rng, term.low, term.high)),
      };

    case 'ability':
      return {
        kind: 'condition',
        condition: {
          kind: 'ability',
          ability: term.ability,
          atLeast: Math.min(maxAbility, between(rng, term.low, term.high)),
        },
      };

    case 'personality':
      return {
        kind: 'condition',
        condition: term.over
          ? { kind: 'personality', axis: term.axis, atLeast: 1 + Math.floor(rng() * 2) }
          : { kind: 'personality', axis: term.axis, atMost: -1 },
      };

    case 'flag':
      return { kind: 'flag', flag: term.flag };
  }
}

export type SignetGenInput = {
  seed: number;
  /** How deep the tower promises to go, and how high a score can be driven. */
  horizon: number;
  maxAbility: number;
  /** What a Signet may claim to strengthen. */
  traits: readonly Trait[];
  language: 'th' | 'en';
  /** How many to offer. */
  count?: number;
};

const ENTRIES: EntryRule[] = ['sequence', 'parallel', 'combination'];

/**
 * The Signets a world may contain.
 *
 * Still only CANDIDATES: `admissible` has the last word, and under generation
 * that is not a formality.
 */
export function generateSignets(input: SignetGenInput): Signet[] {
  const rng = mulberry32((input.seed ^ 0x51672) >>> 0);
  const count = input.count ?? 4 + Math.floor(rng() * 3);
  const signets: Signet[] = [];

  /*
   * Themes are dealt, not drawn.
   *
   * Picking one at random per Signet let a world roll the same theme twice and
   * then coincide on the terms as well — two identical Signets of the Ledger
   * Hand, same name, same gate. Dealing from a shuffled deck means every theme
   * is used before any is repeated.
   */
  const deck = [...THEMES].sort(() => rng() - 0.5);
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const theme = deck[i % deck.length];

    /*
     * Two to three terms. More than three and a gate stops being a description
     * of a person and starts being a checklist nobody could hold in mind.
     *
     * Re-drawn if it lands on a gate this world already has: a second Signet
     * demanding exactly the same things is not a second Signet.
     */
    let gates: Gate[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const pool = [...theme.terms].sort(() => rng() - 0.5);
      const terms = pool.slice(0, 2 + Math.floor(rng() * 2));
      gates = terms.map((t) => gateFor(rng, t, input.horizon, input.maxAbility));

      const signature = JSON.stringify(gates);
      if (!seen.has(signature)) {
        seen.add(signature);
        break;
      }
    }

    // `any` is the two-routes-in shape, which is what makes a Signet feel found
    // rather than assigned. Rarer than `all`, because it is far easier to open.
    const gate: Gate = rng() < 0.25 && gates.length > 1
      ? { kind: 'any', of: gates }
      : { kind: 'all', of: gates };

    // Indexed rather than drawn, so two Signets of one theme cannot land on the
    // same words even when the dice would allow it.
    const qualifier = theme.qualifiers[(i + Math.floor(rng() * theme.qualifiers.length)) % theme.qualifiers.length][input.language];
    const noun = theme.nouns[(i + 1 + Math.floor(rng() * theme.nouns.length)) % theme.nouns.length][input.language];
    const id = `signet_${theme.id}_${i}`;

    const grant: NodeGrant = rng() < 0.5
      ? { ability: { [pick(rng, ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const)]: 1 }, maxHp: 3 }
      : { attack: 1, damage: 1 };

    const augments = input.traits.length > 0 ? pick(rng, input.traits).id : 'blooded';

    signets.push({
      id,
      name: input.language === 'th' ? `ตราแห่ง${qualifier}${noun}` : `Signet of the ${qualifier} ${noun}`,
      description: theme.rumour[input.language],
      augments: { kind: 'trait', id: augments },
      gate,
      grant,
      // Half are never announced. A hidden one must never be the only route to
      // anything, which is why nothing else gates on holding one.
      discovery: rng() < 0.5 ? 'hinted' : 'hidden',
      hint: theme.rumour[input.language],
      opens: {
        stat: pick(rng, theme.stats),
        entry: pick(rng, ENTRIES),
        size: 3 + Math.floor(rng() * 3),
        needs: 2 + Math.floor(rng() * 2),
      },
    });
  }

  return signets;
}
