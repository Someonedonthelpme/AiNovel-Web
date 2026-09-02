import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { EntryRule } from './graft.ts';
import type { Ability } from '../combat/types.ts';
import type { Axis } from '../character/persona.ts';
import { COUNTERS } from './traits.ts';
import type { Trait, TraitCondition } from './traits.ts';

/**
 * Generating traits.
 *
 * The last of the three systems, and the one that needed the most care, because
 * A SKILL IS A MECHANISM AND A TRAIT IS A CHARACTERISATION. Mechanisms compose.
 * Characterisation does not: draw conditions freely and you get a mechanically
 * valid statement about nobody — "thirty kills and twenty short rests and a
 * charisma of fifteen" is a person no name fits.
 *
 * So a trait draws inside ONE THEME. A theme is a kind of person — violent,
 * enduring, deep, curious, sociable, careful, alone — and it carries both the
 * conditions belonging to that person AND the words that name them. One world
 * asks kills and strength, another kills and coldness; both read as the same
 * kind of person, so both can be called Butcher.
 *
 * FAVOURED THEMES TOP UP RATHER THAN FILTER, and that asymmetry is the whole
 * safety argument. `sheet.traits` stores ids, so a catalogue that could REMOVE
 * an entry would orphan a trait a character had already earned — its bonus
 * would vanish and the branch it grew would fall off the tree mid-run. A list
 * that only ever grows cannot do that, which is why the class, the subclass,
 * the world and the background ADD traits nobody else is offered instead of
 * narrowing the ones everybody gets.
 *
 * It also means taking a subclass at level three adds traits mid-run, which is
 * consistent with it adding a branch, and safe for the same reason.
 */

type Bilingual = { en: string; th: string };

/** A term a theme may draw. Each maps onto a `TraitCondition`. */
type TermKind =
  | { kind: 'counter'; counter: string; low: number; high: number }
  | { kind: 'ability'; ability: Ability; low: number; high: number }
  | { kind: 'personality'; axis: Axis; over: boolean }
  | { kind: 'level'; low: number; high: number };

export type TraitTheme = {
  id: string;
  /** Conditions that describe one kind of person. */
  terms: TermKind[];
  /** The words a name is built from. */
  adjectives: Bilingual[];
  nouns: Bilingual[];
  /** What it says about you, when it grants no score. */
  notes: Bilingual[];
  /** The score a bump goes to, when it grants one. */
  ability: Ability;
  /** The stats its branch grows on. */
  stats: Ability[];
};

export const THEMES: readonly TraitTheme[] = [
  {
    id: 'violence',
    terms: [
      { kind: 'counter', counter: COUNTERS.kills, low: 12, high: 40 },
      { kind: 'counter', counter: COUNTERS.fightsWon, low: 6, high: 20 },
      { kind: 'ability', ability: 'str', low: 14, high: 17 },
      { kind: 'personality', axis: 'warmth', over: false },
    ],
    adjectives: [
      { en: 'Blooded', th: 'เปื้อนเลือด' }, { en: 'Cold', th: 'เย็นชา' },
      { en: 'Certain', th: 'แน่วแน่' }, { en: 'Red', th: 'แดง' },
    ],
    nouns: [
      { en: 'Hand', th: 'มือ' }, { en: 'Work', th: 'งาน' },
      { en: 'Count', th: 'การนับ' }, { en: 'Answer', th: 'คำตอบ' },
    ],
    notes: [
      { en: 'You have stopped flinching first.', th: 'คุณเลิกสะดุ้งก่อนใครแล้ว' },
      { en: 'Frightened people tell you things.', th: 'คนที่กลัวมักบอกอะไรกับคุณ' },
      { en: 'You no longer rehearse it beforehand.', th: 'คุณไม่ต้องซ้อมในหัวก่อนอีกแล้ว' },
      { en: 'Rooms go quiet a little before you speak.', th: 'ห้องจะเงียบลงเล็กน้อยก่อนที่คุณจะพูด' },
    ],
    ability: 'str',
    stats: ['str', 'agi', 'int'],
  },
  {
    id: 'endurance',
    terms: [
      { kind: 'counter', counter: COUNTERS.fightsLost, low: 1, high: 5 },
      { kind: 'counter', counter: COUNTERS.fightsWon, low: 8, high: 22 },
      { kind: 'ability', ability: 'con', low: 13, high: 17 },
      { kind: 'personality', axis: 'nerve', over: true },
    ],
    adjectives: [
      { en: 'Unbroken', th: 'ไม่แตกหัก' }, { en: 'Standing', th: 'ยังยืน' },
      { en: 'Hard', th: 'แข็ง' }, { en: 'Slow', th: 'เชื่องช้า' },
    ],
    nouns: [
      { en: 'Bone', th: 'กระดูก' }, { en: 'Wall', th: 'กำแพง' },
      { en: 'Return', th: 'การกลับมา' }, { en: 'Back', th: 'แผ่นหลัง' },
    ],
    notes: [
      { en: 'You have gone down and got back up.', th: 'คุณเคยล้ม และลุกขึ้นมาแล้ว' },
      { en: 'The second day hurts less than it should.', th: 'วันที่สองเจ็บน้อยกว่าที่ควรจะเป็น' },
      { en: 'You have learned which pain is worth stopping for.', th: 'คุณเรียนรู้แล้วว่าความเจ็บแบบไหนควรค่าแก่การหยุด' },
      { en: 'Nobody expects you to still be here, and here you are.', th: 'ไม่มีใครคิดว่าคุณจะยังอยู่ และคุณก็ยังอยู่' },
    ],
    ability: 'con',
    stats: ['vit', 'con', 'str'],
  },
  {
    id: 'depth',
    terms: [
      { kind: 'counter', counter: COUNTERS.deepestFloor, low: 6, high: 14 },
      { kind: 'counter', counter: COUNTERS.floorsClimbed, low: 4, high: 16 },
      { kind: 'ability', ability: 'wis', low: 13, high: 17 },
      { kind: 'level', low: 5, high: 10 },
    ],
    adjectives: [
      { en: 'Deep', th: 'ลึก' }, { en: 'Upper', th: 'เบื้องบน' },
      { en: 'Long', th: 'ยาวไกล' }, { en: 'Thin', th: 'เบาบาง' },
    ],
    nouns: [
      { en: 'Walker', th: 'ผู้เดิน' }, { en: 'Stair', th: 'บันได' },
      { en: 'Climb', th: 'การไต่' }, { en: 'Air', th: 'อากาศ' },
    ],
    notes: [
      { en: 'The tower has stopped being strange.', th: 'หอคอยไม่แปลกสำหรับคุณอีกแล้ว' },
      { en: 'You read a new floor faster than you used to.', th: 'คุณอ่านชั้นใหม่ได้เร็วกว่าเดิม' },
      { en: 'You can tell how high you are with your eyes shut.', th: 'คุณบอกได้ว่าอยู่สูงแค่ไหนโดยไม่ต้องลืมตา' },
      { en: 'The air up here does not bother you any more.', th: 'อากาศข้างบนนี้ไม่รบกวนคุณอีกต่อไป' },
    ],
    ability: 'wis',
    stats: ['wis', 'con', 'int'],
  },
  {
    id: 'curiosity',
    terms: [
      { kind: 'counter', counter: COUNTERS.placesFound, low: 10, high: 30 },
      { kind: 'counter', counter: COUNTERS.itemsUsed, low: 10, high: 30 },
      { kind: 'ability', ability: 'int', low: 13, high: 17 },
      { kind: 'personality', axis: 'candour', over: true },
    ],
    adjectives: [
      { en: 'Wandering', th: 'ระหกระเหิน' }, { en: 'Open', th: 'เปิดกว้าง' },
      { en: 'Restless', th: 'ไม่อยู่นิ่ง' }, { en: 'Wide', th: 'กว้าง' },
    ],
    nouns: [
      { en: 'Map', th: 'แผนที่' }, { en: 'Door', th: 'ประตู' },
      { en: 'Eye', th: 'ดวงตา' }, { en: 'Road', th: 'ถนน' },
    ],
    notes: [
      { en: 'You notice the way out before you need it.', th: 'คุณเห็นทางออกก่อนที่จะต้องใช้มัน' },
      { en: 'You have walked into more rooms than you can name.', th: 'คุณเดินเข้าห้องมามากกว่าที่จะเรียกชื่อได้หมด' },
      { en: 'You open things other people walk past.', th: 'คุณเปิดสิ่งที่คนอื่นเดินผ่านไป' },
      { en: 'Nothing here is quite as unfamiliar as it was.', th: 'ไม่มีอะไรที่นี่แปลกหน้าเท่าเมื่อก่อนอีกแล้ว' },
    ],
    ability: 'int',
    stats: ['cha', 'wis', 'agi'],
  },
  {
    id: 'sociability',
    terms: [
      { kind: 'counter', counter: COUNTERS.peopleMet, low: 8, high: 22 },
      { kind: 'ability', ability: 'cha', low: 13, high: 17 },
      { kind: 'personality', axis: 'warmth', over: true },
      { kind: 'personality', axis: 'loyalty', over: true },
    ],
    adjectives: [
      { en: 'Known', th: 'เป็นที่รู้จัก' }, { en: 'Owed', th: 'ติดค้าง' },
      { en: 'Welcome', th: 'ได้รับการต้อนรับ' }, { en: 'Named', th: 'มีชื่อ' },
    ],
    nouns: [
      { en: 'Face', th: 'ใบหน้า' }, { en: 'Word', th: 'คำพูด' },
      { en: 'Table', th: 'โต๊ะ' }, { en: 'Debt', th: 'หนี้' },
    ],
    notes: [
      { en: 'People have started recognising you.', th: 'ผู้คนเริ่มจำคุณได้' },
      { en: 'Your name arrives in a room before you do.', th: 'ชื่อของคุณไปถึงห้องก่อนตัวคุณ' },
      { en: 'Somebody would put you up, if you asked.', th: 'มีคนยอมให้คุณพักด้วย ถ้าคุณเอ่ยปาก' },
      { en: 'You are owed favours you have not called in.', th: 'คุณมีบุญคุณค้างที่ยังไม่ได้ทวง' },
    ],
    ability: 'cha',
    stats: ['cha', 'wis'],
  },
  {
    id: 'craft',
    terms: [
      { kind: 'counter', counter: COUNTERS.itemsUsed, low: 14, high: 36 },
      { kind: 'ability', ability: 'int', low: 14, high: 18 },
      { kind: 'personality', axis: 'discipline', over: true },
      { kind: 'counter', counter: COUNTERS.floorsClimbed, low: 5, high: 14 },
    ],
    adjectives: [
      { en: 'Measured', th: 'ตวงแล้ว' }, { en: 'Careful', th: 'ระมัดระวัง' },
      { en: 'Bitter', th: 'ขม' }, { en: 'Steady', th: 'มั่นคง' },
    ],
    nouns: [
      { en: 'Dose', th: 'ปริมาณยา' }, { en: 'Hand', th: 'มือ' },
      { en: 'Page', th: 'หน้ากระดาษ' }, { en: 'Scale', th: 'ตราชั่ง' },
    ],
    notes: [
      { en: 'You know what is in the phial before you drink it.', th: 'คุณรู้ว่าในขวดมีอะไรก่อนจะดื่ม' },
      { en: 'Nothing in your pack is there by accident.', th: 'ไม่มีอะไรในเป้ของคุณที่อยู่ตรงนั้นโดยบังเอิญ' },
      { en: 'You measure twice, and it has saved you twice.', th: 'คุณวัดสองครั้ง และมันช่วยคุณไว้สองครั้ง' },
      { en: 'You have started reading labels other people invent.', th: 'คุณเริ่มอ่านฉลากที่คนอื่นแต่งขึ้นเอง' },
    ],
    ability: 'int',
    stats: ['int'],
  },
  {
    id: 'solitude',
    terms: [
      { kind: 'counter', counter: COUNTERS.shortRests, low: 10, high: 28 },
      { kind: 'counter', counter: COUNTERS.longRests, low: 3, high: 10 },
      { kind: 'ability', ability: 'con', low: 13, high: 16 },
      { kind: 'personality', axis: 'warmth', over: false },
    ],
    adjectives: [
      { en: 'Hard', th: 'แข็งกร้าว' }, { en: 'Quiet', th: 'เงียบ' },
      { en: 'Still', th: 'นิ่งงัน' }, { en: 'Alone', th: 'ลำพัง' },
    ],
    nouns: [
      { en: 'Camp', th: 'ค่าย' }, { en: 'Watch', th: 'การเฝ้า' },
      { en: 'Night', th: 'ราตรี' }, { en: 'Stone', th: 'ศิลา' },
    ],
    notes: [
      { en: 'You can sleep on stone and wake up useful.', th: 'คุณนอนบนหินแล้วตื่นมาทำงานได้' },
      { en: 'A short rest costs you less than it costs other people.', th: 'การพักสั้นราคาถูกกว่าสำหรับคุณ' },
      { en: 'You keep the last watch, because you always do.', th: 'คุณเฝ้ายามกะสุดท้าย เพราะคุณทำแบบนั้นเสมอ' },
      { en: 'Company has become a thing you visit, not a thing you need.', th: 'การมีเพื่อนกลายเป็นสิ่งที่คุณแวะไปหา ไม่ใช่สิ่งที่คุณต้องการ' },
    ],
    ability: 'con',
    stats: ['con', 'vit', 'agi'],
  },
];

export const themeById = (id: string): TraitTheme | null =>
  THEMES.find((t) => t.id === id) ?? null;

/* -------------------------------------------------------------------------- */
/* Building one                                                                */
/* -------------------------------------------------------------------------- */

const ENTRIES: EntryRule[] = ['sequence', 'parallel', 'combination'];

const between = (rng: Rng, low: number, high: number): number =>
  low + Math.floor(rng() * Math.max(1, high - low + 1));

/** Turn a theme's term into a condition the fold can evaluate. */
function conditionFor(rng: Rng, term: TermKind, demand: number): TraitCondition {
  const scale = (n: number) => Math.max(1, Math.round(n * demand));

  switch (term.kind) {
    case 'counter':
      return { kind: 'counter', counter: term.counter, atLeast: scale(between(rng, term.low, term.high)) };
    case 'ability':
      // Scores are NOT scaled by demand. A tower may want more OF you; it
      // cannot move the ceiling on what a person is able to become.
      return { kind: 'ability', ability: term.ability, atLeast: between(rng, term.low, term.high) };
    case 'personality':
      return term.over
        ? { kind: 'personality', axis: term.axis, atLeast: 1 }
        : { kind: 'personality', axis: term.axis, atMost: -1 };
    case 'level':
      return { kind: 'level', atLeast: between(rng, term.low, term.high) };
  }
}

/** A stable signature, so one source cannot offer the same trait twice. */
const signatureOf = (theme: TraitTheme, requires: readonly TraitCondition[]): string =>
  `${theme.id}|${requires.map((c) =>
    c.kind === 'counter' ? `counter:${c.counter}`
      : c.kind === 'ability' ? `ability:${c.ability}`
        : c.kind === 'personality' ? `personality:${c.axis}` : 'level',
  ).sort().join('+')}`;

export type TraitDraw = {
  rng: Rng;
  theme: TraitTheme;
  /** Namespaces the id, so an extra can never collide with a base trait. */
  id: string;
  demand: number;
  language: 'th' | 'en';
  /** Bumped per trait, so two of one theme cannot land on the same words. */
  index: number;
};

export function composeTrait(draw: TraitDraw): { trait: Trait; signature: string } {
  const { rng, theme, demand, language, index } = draw;

  /*
   * One term or two. Three reads as a checklist rather than a description of
   * somebody, and the authored twelve never used more than two either.
   *
   * THE FIRST IS ALWAYS SOMETHING YOU DID. Drawing freely produced traits
   * whose only condition was a personality axis — "Blooded Work: be unkind" —
   * which is not an achievement, it is a description handed out for free on
   * turn one. A score or a leaning can QUALIFY a deed; it cannot be the deed.
   * The authored twelve pair every personality condition with a tally for the
   * same reason.
   */
  const shuffled = [...theme.terms].sort(() => rng() - 0.5);
  const isDeed = (t: TermKind) => t.kind === 'counter' || t.kind === 'level';
  const deeds = shuffled.filter(isDeed);
  const rest = shuffled.filter((t) => !isDeed(t));

  const terms: TermKind[] = [deeds[0] ?? shuffled[0]];
  if (rng() >= 0.3) {
    const second = [...deeds.slice(1), ...rest][Math.floor(rng() * Math.max(1, deeds.length - 1 + rest.length))];
    if (second) terms.push(second);
  }
  const requires = terms.map((t) => conditionFor(rng, t, demand));

  // Indexed rather than drawn, so two traits of one theme cannot collide on
  // the words even where the dice would allow it.
  const adjective = theme.adjectives[(index + Math.floor(rng() * theme.adjectives.length)) % theme.adjectives.length][language];
  const noun = theme.nouns[(index + 1 + Math.floor(rng() * theme.nouns.length)) % theme.nouns.length][language];
  const note = theme.notes[Math.floor(rng() * theme.notes.length)][language];

  /*
   * A branch, or not. A tree that sprouted on every tally would be noise, so
   * only about half of them mark a change in what you can DO rather than
   * merely what you have done.
   */
  const opens = rng() < 0.5
    ? {
        stat: theme.stats[Math.floor(rng() * theme.stats.length)],
        entry: ENTRIES[Math.floor(rng() * ENTRIES.length)],
        size: 2 + Math.floor(rng() * 4),
        needs: 2 + Math.floor(rng() * 2),
      }
    : undefined;

  const trait: Trait = {
    id: draw.id,
    name: language === 'th' ? `${noun}${adjective}` : `${adjective} ${noun}`,
    description: note,
    requires,
    // A score where the theme has one to give, a line about you otherwise.
    grants: rng() < 0.6 ? { ability: { [theme.ability]: 1 } } : { note },
    opens,
  };

  return { trait, signature: signatureOf(theme, requires) };
}

/* -------------------------------------------------------------------------- */
/* A world's list, and what tops it up                                         */
/* -------------------------------------------------------------------------- */

/** Everything that can favour a theme. All of it is on the sheet, and folded. */
export type TraitOrigin = {
  classId?: string;
  subclassId?: string;
  background?: string;
  language?: 'th' | 'en';
};

/**
 * Which theme each class leans toward.
 *
 * Authored, because a class IS a characterisation, and deriving it from the
 * discipline list would put the Bard and the Rogue in the same place.
 */
const CLASS_THEMES: Record<string, string> = {
  fighter: 'violence',
  barbarian: 'endurance',
  ranger: 'depth',
  rogue: 'curiosity',
  wizard: 'craft',
  warlock: 'craft',
  oracle: 'depth',
  bard: 'sociability',
};

/** Words a background might carry, and the theme each one points at. */
const BACKGROUND_WORDS: [RegExp, string][] = [
  [/soldier|guard|merc|นักรบ|ทหาร|องครักษ์/i, 'violence'],
  [/farm|labour|smith|porter|ชาวนา|กรรมกร|ช่างตีเหล็ก/i, 'endurance'],
  [/climb|scout|ranger|นักปีน|พราน|ลาดตระเวน/i, 'depth'],
  [/scholar|scribe|student|นักเรียน|อาลักษณ์|บัณฑิต/i, 'curiosity'],
  [/merchant|priest|singer|host|พ่อค้า|นักบวช|นักร้อง/i, 'sociability'],
  [/alchem|apothec|cook|เภสัช|นักเล่นแร่|พ่อครัว/i, 'craft'],
  [/hermit|exile|orphan|ฤๅษี|ผู้ถูกเนรเทศ|กำพร้า/i, 'solitude'],
];

/** A stable hash, for when nothing else says which way a thing leans. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

const themeAt = (n: number): TraitTheme => THEMES[n % THEMES.length];

/**
 * The themes this particular run favours, and who favoured them.
 *
 * Four contributors, each naming ONE theme. The source is part of the id, so a
 * class extra and a subclass extra of the same theme are still two different
 * traits — and, more importantly, so taking a subclass cannot renumber the
 * class extras a character may already have earned.
 */
export function favouredThemes(
  seed: number,
  origin: TraitOrigin,
  subclassOpens?: Ability,
): { source: string; theme: TraitTheme }[] {
  const out: { source: string; theme: TraitTheme }[] = [];

  /*
   * THE ORDER IS LOAD-BEARING, and it is the reason the subclass comes last.
   *
   * Two traits landing on the same words read as a bug, so a collision has to
   * be resolved somehow — and resolving one means the LATER of the pair
   * re-draws. That is only safe if nothing can ever be inserted ahead of a
   * source after the fact. Everything here but the subclass is fixed at
   * character creation; the subclass arrives at level three. Putting it last
   * means it can be bumped by the others and can never bump them.
   */

  // The world itself leans, so two characters of one class in different towers
  // are still offered different things.
  out.push({ source: 'world', theme: themeAt(hash(`world_${seed}`)) });

  if (origin.background) {
    const matched = BACKGROUND_WORDS.find(([re]) => re.test(origin.background!));
    out.push({
      source: 'background',
      theme: matched ? themeById(matched[1])! : themeAt(hash(origin.background)),
    });
  }

  const cls = origin.classId ? CLASS_THEMES[origin.classId] : undefined;
  if (cls) out.push({ source: `class_${origin.classId}`, theme: themeById(cls)! });

  /*
   * A subclass leans wherever its island points. Derived rather than authored,
   * because a subclass is DEFINED by the discipline it crosses into, and a
   * second table of sixteen would drift out of step with the first.
   */
  if (origin.subclassId) {
    const byDiscipline = subclassOpens
      ? THEMES.find((t) => t.stats.includes(subclassOpens))
      : undefined;
    out.push({
      source: `subclass_${origin.subclassId}`,
      theme: byDiscipline ?? themeAt(hash(origin.subclassId)),
    });
  }

  return out;
}

export type GenerateInput = {
  seed: number;
  count: number;
  origin?: TraitOrigin;
  subclassOpens?: Ability;
};

/**
 * The traits a world offers.
 *
 * Drawn widely first, then topped up. THE BASE LIST DOES NOT DEPEND ON THE
 * ORIGIN — it is a pure function of the seed and the count — which is what
 * makes topping up safe: nothing a character does mid-run can shift the ids
 * underneath the traits they have already earned.
 */
export function generateTraits(input: GenerateInput): Trait[] {
  const rng = mulberry32((input.seed ^ 0x7a17) >>> 0);
  const language = input.origin?.language ?? 'en';

  // Thresholds move together, so a world reads as demanding or forgiving
  // rather than as a scatter of unrelated numbers.
  const demand = 0.75 + rng() * 0.75;

  const seen = new Set<string>();
  const traits: Trait[] = [];

  const add = (stream: Rng, scope: string, theme: TraitTheme, id: string, index: number) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { trait, signature } = composeTrait({ rng: stream, theme, id, demand, language, index });

      // Conditions are deduped WITHIN a source — two traits asking exactly the
      // same things are one trait wearing two names. Scoping it keeps a source
      // that is absent from changing one that is present.
      if (seen.has(`sig|${scope}|${signature}`)) continue;

      /*
       * Names and lines are deduped ACROSS the whole list. "Long Air" twice
       * reads as a bug however different the two are, and so does a list where
       * two traits both explain that you know what is in the phial before you
       * drink it — which is what shipped until the panel was actually read.
       *
       * Both are global checks, and are only safe because the sources are
       * ordered with the subclass — the one thing that can arrive mid-run —
       * last, so a re-draw can never reach backwards into what somebody has
       * already earned.
       */
      if (seen.has(`name|${trait.name}`)) continue;
      if (seen.has(`desc|${trait.description}`)) continue;

      seen.add(`sig|${scope}|${signature}`);
      seen.add(`name|${trait.name}`);
      seen.add(`desc|${trait.description}`);
      traits.push(trait);
      return;
    }
  };

  // Dealt rather than drawn, so a world uses every kind of person it has
  // before offering a second of any one.
  const deck = [...THEMES].sort(() => rng() - 0.5);
  for (let i = 0; i < input.count; i++) {
    const theme = deck[i % deck.length];
    add(rng, 'base', theme, `trait_${theme.id}_${i}`, i);
  }

  /*
   * And the top-up. These exist only in this run, for this character — a
   * Fighter with a soldier's background in a violent tower is offered
   * violence-and-figures nobody else will ever be shown.
   *
   * EACH SOURCE DRAWS FROM ITS OWN STREAM, and that is not tidiness. Sharing
   * one stream would mean that taking a subclass at level three — which
   * inserts a source into the middle of this loop — moved every extra after
   * it: a trait earned at thirty kills would quietly start reading forty. The
   * index is hashed from the source for the same reason, and the dedupe is
   * scoped to the source so an absent one cannot change a present one.
   */
  if (input.origin) {
    for (const { source, theme } of favouredThemes(input.seed, input.origin, input.subclassOpens)) {
      const own = mulberry32((input.seed ^ hash(source)) >>> 0);
      const extra = 1 + Math.floor(own() * 2);
      for (let i = 0; i < extra; i++) {
        add(own, source, theme, `trait_${source}_${theme.id}_${i}`, hash(`${source}_${i}`) % 97);
      }
    }
  }

  return traits;
}
