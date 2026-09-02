import { mulberry32 } from '../engine/roll.ts';
import type { ArchetypeId } from './archetypes.ts';
import type { EntryRule } from './graft.ts';
import { SHAPES } from './traits.ts';
import type { Trait } from './traits.ts';

/**
 * Emergent traits: what the tally says about you sideways.
 *
 * DECLARED TRAITS ARE GOALS; THESE ARE RECOGNITIONS. That distinction is the
 * whole of it. A declared trait can be shown in the panel with progress against
 * it, because wanting it is fine — walking toward "thirty kills" is playing the
 * game. An emergent one CANNOT be foreshadowed, because the moment "you have
 * killed more people than you have spoken to" is displayed as a target, the
 * aiming begins, and the aiming is exactly what the trait claims you did not do.
 *
 * So they arrive unannounced, in the fold, at the moment the shape becomes true
 * — and `progressOf` gives them no numbers on purpose.
 *
 * The SHAPES are authored, in traits.ts beside the evaluator; there are only so
 * many relations between nine tallies that mean anything, and inventing more
 * would produce observations about nobody. What is generated is the naming, per
 * world: the same shape is The Unspeaking in one tower and The Quiet Count in
 * another, so two players who arrived the same way are not handed the same
 * words for it.
 *
 * AND THEY ARE CAPPED — not here, but at the tree. See `EMERGENT_BRANCH_CAP`.
 */

type Bilingual = { en: string; th: string };

type Dressing = {
  /** Words the name is built from. Drawn per world. */
  qualifiers: Bilingual[];
  nouns: Bilingual[];
  /** What it says. Written flat, because the observation is the drama. */
  line: Bilingual;
  disciplines: ArchetypeId[];
};

const DRESSING: Record<string, Dressing> = {
  unspeaking: {
    qualifiers: [{ en: 'Unspeaking', th: 'ไม่พูด' }, { en: 'Quiet', th: 'เงียบ' }, { en: 'Wordless', th: 'ไร้คำ' }],
    nouns: [{ en: 'Count', th: 'การนับ' }, { en: 'Road', th: 'ถนน' }, { en: 'Hand', th: 'มือ' }],
    line: {
      en: 'You have killed more things than you have spoken to.',
      th: 'คุณฆ่ามามากกว่าที่คุณได้พูดคุยด้วย',
    },
    disciplines: ['shadow', 'sword', 'blackMagic'],
  },
  sleepless: {
    qualifiers: [{ en: 'Sleepless', th: 'ไม่หลับ' }, { en: 'Waking', th: 'ตื่น' }, { en: 'Long', th: 'ยาวนาน' }],
    nouns: [{ en: 'Watch', th: 'การเฝ้า' }, { en: 'Night', th: 'ราตรี' }, { en: 'Climb', th: 'การไต่' }],
    line: {
      en: 'You have not slept properly since the ground floor, and it shows.',
      th: 'คุณไม่ได้นอนเต็มตื่นเลยตั้งแต่ชั้นล่าง และมันก็เห็นได้',
    },
    disciplines: ['survival', 'shadow', 'wisdom'],
  },
  stubborn: {
    qualifiers: [{ en: 'Stubborn', th: 'ดื้อรั้น' }, { en: 'Returning', th: 'หวนกลับ' }, { en: 'Standing', th: 'ยังยืน' }],
    nouns: [{ en: 'Bone', th: 'กระดูก' }, { en: 'Wall', th: 'กำแพง' }, { en: 'Answer', th: 'คำตอบ' }],
    line: {
      en: 'You lose often, and you keep coming back, and people have noticed.',
      th: 'คุณแพ้บ่อย และคุณก็กลับมาเรื่อย ๆ และผู้คนก็สังเกตเห็น',
    },
    disciplines: ['guard', 'survival', 'sword'],
  },
  ground_down: {
    qualifiers: [{ en: 'Worn', th: 'สึกกร่อน' }, { en: 'Ground', th: 'ถูกบด' }, { en: 'Thin', th: 'บางลง' }],
    nouns: [{ en: 'Edge', th: 'คม' }, { en: 'Stone', th: 'ศิลา' }, { en: 'Year', th: 'ปี' }],
    line: {
      en: 'The tower has taken more from you than you have taken from it.',
      th: 'หอคอยเอาไปจากคุณมากกว่าที่คุณเอามาจากมัน',
    },
    disciplines: ['survival', 'guard', 'wisdom'],
  },
  hoarder: {
    qualifiers: [{ en: 'Laden', th: 'หนักอึ้ง' }, { en: 'Saving', th: 'เก็บออม' }, { en: 'Full', th: 'เต็ม' }],
    nouns: [{ en: 'Pack', th: 'เป้' }, { en: 'Hand', th: 'มือ' }, { en: 'Shelf', th: 'ชั้นวาง' }],
    line: {
      en: 'You carry everything and use almost none of it.',
      th: 'คุณแบกทุกอย่างไว้ และแทบไม่ได้ใช้มันเลย',
    },
    disciplines: ['guile', 'venom', 'wisdom'],
  },
  spendthrift: {
    qualifiers: [{ en: 'Spending', th: 'สุรุ่ยสุร่าย' }, { en: 'Open', th: 'เปิด' }, { en: 'Quick', th: 'ฉับไว' }],
    nouns: [{ en: 'Purse', th: 'ถุงเงิน' }, { en: 'Dose', th: 'ปริมาณยา' }, { en: 'Hand', th: 'มือ' }],
    line: {
      en: 'You solve more with the pack than with the blade.',
      th: 'คุณแก้ปัญหาด้วยของในเป้มากกว่าด้วยคมดาบ',
    },
    disciplines: ['venom', 'magic', 'flame'],
  },
  headlong: {
    qualifiers: [{ en: 'Headlong', th: 'บุ่มบ่าม' }, { en: 'Unresting', th: 'ไม่พัก' }, { en: 'Fast', th: 'เร็ว' }],
    nouns: [{ en: 'Stair', th: 'บันได' }, { en: 'Climb', th: 'การไต่' }, { en: 'Line', th: 'เส้น' }],
    line: {
      en: 'You climb faster than you recover, and you have not stopped to think about it.',
      th: 'คุณไต่เร็วกว่าที่คุณฟื้นตัว และคุณก็ไม่เคยหยุดคิดถึงมัน',
    },
    disciplines: ['survival', 'shadow', 'wisdom'],
  },
  unbloodied: {
    qualifiers: [{ en: 'Unbloodied', th: 'ไร้เลือด' }, { en: 'Open', th: 'เปิดเผย' }, { en: 'Spoken', th: 'ผ่านคำพูด' }],
    nouns: [{ en: 'Word', th: 'คำพูด' }, { en: 'Table', th: 'โต๊ะ' }, { en: 'Face', th: 'ใบหน้า' }],
    line: {
      en: 'You have got this far mostly by talking, which almost nobody manages.',
      th: 'คุณมาไกลขนาดนี้ด้วยการพูดเป็นส่วนใหญ่ ซึ่งแทบไม่มีใครทำได้',
    },
    disciplines: ['song', 'guile', 'wisdom'],
  },
  out_of_depth: {
    qualifiers: [{ en: 'Overreaching', th: 'เกินตัว' }, { en: 'Early', th: 'ก่อนกำหนด' }, { en: 'Thin', th: 'เบาบาง' }],
    nouns: [{ en: 'Air', th: 'อากาศ' }, { en: 'Ledge', th: 'ขอบผา' }, { en: 'Step', th: 'ก้าว' }],
    line: {
      en: 'You are further up than anybody at your weight has business being.',
      th: 'คุณขึ้นมาสูงกว่าที่คนระดับคุณควรจะอยู่',
    },
    disciplines: ['magic', 'blackMagic', 'shadow'],
  },
};

/**
 * How many emergent branches a run may grow.
 *
 * The one real risk in the whole design, and the reason this number exists.
 * Declared sources are BOUNDED — a world offers a dozen traits, a character
 * holds a handful of Signets, a class has three subclass stages. Emergent
 * sources are not: a long run drives every counter, and every shape that
 * becomes true would grow another branch. The tree would sprawl into noise and
 * the point of a legible web would be lost.
 *
 * So the recognitions are unlimited — arriving unannounced is what they are
 * for — but only the first few grow anything. The rest give their bonus and
 * their line and nothing else.
 */
export const EMERGENT_BRANCH_CAP = 3;

/** Emergent ids are prefixed, so the cap can find them among the declared. */
export const EMERGENT_PREFIX = 'emergent_';

export const isEmergent = (traitId: string): boolean => traitId.startsWith(EMERGENT_PREFIX);

/**
 * The emergent traits this world can mint, named in this world's words.
 *
 * Every shape, always — unlike declared traits, a world does not offer a
 * SUBSET of these. A recognition you could not have received because the tower
 * did not deal it would be a strange thing: what you did, you did.
 */
export function emergentTraitsFor(seed: number, language: 'th' | 'en' = 'en'): Trait[] {
  const rng = mulberry32((seed ^ 0x3e3a) >>> 0);

  return SHAPES.map((shape) => {
    const dress = DRESSING[shape.id];
    const qualifier = dress.qualifiers[Math.floor(rng() * dress.qualifiers.length)][language];
    const noun = dress.nouns[Math.floor(rng() * dress.nouns.length)][language];

    return {
      id: `${EMERGENT_PREFIX}${shape.id}`,
      name: language === 'th' ? `${noun}${qualifier}` : `The ${qualifier} ${noun}`,
      description: dress.line[language],
      requires: [{ kind: 'shape', shape: shape.id }],
      // Always a line, never a score. A recognition that handed out +1 str
      // would turn into something worth playing toward, which is the one thing
      // an emergent trait must not be.
      grants: { note: dress.line[language] },
      opens: {
        archetype: dress.disciplines[Math.floor(rng() * dress.disciplines.length)],
        entry: (['sequence', 'parallel', 'combination'] as EntryRule[])[Math.floor(rng() * 3)],
        size: 2 + Math.floor(rng() * 3),
        needs: 2,
      },
    } satisfies Trait;
  });
}
