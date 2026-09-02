import type { Ability, Attack } from '../combat/types.ts';
import type { ArchetypeId, Bilingual, SkillSpec } from '../play/archetypes.ts';
import type { ActiveSkill } from '../skills/active.ts';
import type { EntryRule } from '../play/graft.ts';

/**
 * Classes.
 *
 * What a character IS, decided by the player rather than guessed from prose.
 *
 * Before this, the most consequential thing about a build — which disciplines
 * the skill tree would hold — was inferred by regex from a background name the
 * model had written. It was a guess, it had already been wrong once, and the
 * player never got to make it.
 *
 * A class carries the mechanics: hit die, the abilities it leans on, what it
 * starts holding, and above all WHICH DISCIPLINES ITS TREE CAN CONTAIN. The
 * model still writes the flavour — the name, the background prose, the voice,
 * the personality — which is the same division of labour as everywhere else in
 * this codebase.
 *
 * `forbidden` is the piece that makes the tree worth exploring. A class does not
 * merely favour some disciplines; it is LOCKED OUT of others, permanently, at
 * any price. A Fighter cannot buy black magic. The only way across that line is
 * an island — the detached clusters that open through play — which turns
 * finding one from "more nodes" into a door somewhere you could not otherwise
 * go. Subclasses are the deliberate version of the same thing: choosing one
 * opens an island into a discipline your class was shut out of.
 */

export type Subclass = {
  id: string;
  name: Bilingual;
  description: Bilingual;
  /**
   * The discipline its island belongs to. ALWAYS one the class is shut out of.
   *
   * This was "usually" and it meant it: twelve of sixteen subclasses opened
   * somewhere the class could already reach, and one of them (the Rogue's)
   * opened a discipline already in its own affinity — a crossing into a room
   * it was standing in. The whole promise of a subclass is the crossing, so it
   * is now enforced rather than intended, and `classes.test.ts` proves it.
   */
  opens: ArchetypeId;
  /** The signature active it grants outright. */
  grants: SkillSpec;
};

/**
 * What a subclass grows, and when.
 *
 * Three stages rather than one parcel: a permanent choice at level three should
 * buy an arc, not a single payout that never speaks again.
 *
 * The first is a COMBINATION, which is the point of it. The crossing into a
 * discipline your class is shut out of only opens once several parts of your
 * own tree line up — so an Eldritch Knight has to have genuinely walked the
 * sword before the figures will take. It bridges the two halves of a build
 * instead of being bolted to the side of one.
 *
 * Later stages hang off the earlier ones, so the branch deepens where you have
 * already been rather than sprouting somewhere new each time.
 */
export const SUBCLASS_STAGES: readonly { level: number; entry: EntryRule; size: number; needs?: number }[] = [
  { level: 3, entry: 'combination', size: 3, needs: 2 },
  { level: 6, entry: 'sequence', size: 4 },
  { level: 10, entry: 'sequence', size: 5 },
];

/** The stages a character has actually reached. */
export const stagesReached = (level: number): number =>
  SUBCLASS_STAGES.filter((stage) => level >= stage.level).length;

export type CharacterClass = {
  id: string;
  name: Bilingual;
  description: Bilingual;
  hitDie: 6 | 8 | 10 | 12;
  primary: Ability;
  secondary: Ability;
  /** Always on the tree. The first is home. */
  core: ArchetypeId[];
  /** Drawn from first when filling the rest of the subset. */
  affinity: ArchetypeId[];
  /**
   * Never GENERATED onto the tree. Two things can still bring one.
   *
   * A subclass island is the deliberate route: choosing one at level three is
   * a permanent decision to cross into somewhere your class refuses to go, and
   * every subclass now crosses — see `opens` below.
   *
   * A SKILL BOOK IS THE ACCIDENTAL ROUTE, and it is kept on purpose. A book is
   * a thing found in the tower, and a found thing teaching you what your
   * training would not is the better version of the same idea: a Warlock who
   * picks up `On Holding Ground` learns a little of the shield-work nobody
   * would have taught them. The class decides what you were TRAINED in, not
   * what the world is allowed to hand you.
   *
   * What stays true either way: the base tree never generates one of these on
   * its own, so crossing is always something that HAPPENED to a character
   * rather than something they rolled.
   */
  forbidden: ArchetypeId[];
  startingAttack: Attack;
  /** The armour base they set out in, or null for whatever they scrounge. */
  startingArmour: number | null;
  subclasses: Subclass[];
};

/* -------------------------------------------------------------------------- */
/* Shorthands                                                                  */
/* -------------------------------------------------------------------------- */

const weapon = (
  id: string,
  name: string,
  ability: Ability,
  sides: number,
  range: number,
  type: string,
): Attack => ({
  id,
  name,
  ability,
  proficient: true,
  range,
  damage: { count: 1, sides, bonusAbility: ability, type },
});

const hinder = (condition: string, rounds: number) =>
  ({ kind: 'hinder', condition, rounds }) as SkillSpec['effect'];
const strike = (damage: number) => ({ kind: 'strike', damage }) as SkillSpec['effect'];
const burst = (damage: number, radius: number) => ({ kind: 'burst', damage, radius }) as SkillSpec['effect'];
const mend = (amount: number) => ({ kind: 'mend', amount }) as SkillSpec['effect'];
const edge = (ability: Ability, bonus: number) => ({ kind: 'edge', ability, bonus }) as SkillSpec['effect'];

/* -------------------------------------------------------------------------- */
/* The classes                                                                 */
/* -------------------------------------------------------------------------- */

export const CLASSES: readonly CharacterClass[] = [
  {
    id: 'fighter',
    name: { en: 'Fighter', th: 'นักรบ' },
    description: {
      en: 'Trained, equipped, and used to being hit. You solve things at arm’s length.',
      th: 'ผ่านการฝึก มีของครบ และชินกับการโดนตี คุณแก้ปัญหาในระยะแขน',
    },
    hitDie: 10,
    primary: 'str',
    secondary: 'con',
    core: ['sword', 'guard'],
    affinity: ['survival', 'bow'],
    forbidden: ['magic', 'blackMagic', 'flame'],
    startingAttack: weapon('atk_longsword', 'longsword', 'str', 8, 1, 'slashing'),
    startingArmour: 13,
    subclasses: [
      {
        id: 'eldritch_knight',
        name: { en: 'Eldritch Knight', th: 'อัศวินอาคม' },
        description: {
          en: 'You learned to read the figures. Nobody in the barracks knows.',
          th: 'คุณเรียนอ่านอักขระมา ไม่มีใครในค่ายรู้',
        },
        opens: 'magic',
        grants: {
          name: { en: 'Warded Blade', th: 'ดาบคุ้มกัน' },
          description: { en: 'The figure holds while the steel works.', th: 'อักขระตรึงไว้ ระหว่างที่เหล็กทำงาน' },
          kind: 'combat', effect: hinder('restrained', 2), range: 1, usesPerRest: 2,
        },
      },
      {
        id: 'banner',
        name: { en: 'Beacon-Bearer', th: 'ผู้ถือประทีป' },
        description: {
          en: 'You carry the light, so people follow you because they can see where you are.',
          th: 'คุณถือแสงไว้ ผู้คนจึงตามคุณเพราะพวกเขาเห็นว่าคุณอยู่ตรงไหน',
        },
        opens: 'flame',
        grants: {
          name: { en: 'Hold the Line', th: 'ยันแนวไว้' },
          description: { en: 'Something lit to put your feet to.', th: 'แสงสักดวงให้ก้าวตาม' },
          kind: 'combat', effect: mend(7), range: 0, usesPerRest: 2,
        },
      },
    ],
  },
  {
    id: 'barbarian',
    name: { en: 'Barbarian', th: 'นักรบเถื่อน' },
    description: {
      en: 'You came down from somewhere harder than this, and it shows.',
      th: 'คุณลงมาจากที่ที่โหดกว่านี้ และมันก็เห็นได้ชัด',
    },
    hitDie: 12,
    primary: 'str',
    secondary: 'con',
    core: ['sword', 'survival'],
    affinity: ['guard', 'shadow'],
    forbidden: ['magic', 'blackMagic', 'song'],
    startingAttack: weapon('atk_greataxe', 'great axe', 'str', 10, 1, 'slashing'),
    startingArmour: null,
    subclasses: [
      {
        id: 'totem',
        name: { en: 'Totem Walker', th: 'ผู้เดินตามรอย' },
        description: {
          en: 'You have started listening to the floor the way animals do, and something has started answering.',
          th: 'คุณเริ่มฟังพื้นแบบที่สัตว์ฟัง และมีบางอย่างเริ่มตอบกลับ',
        },
        opens: 'magic',
        grants: {
          name: { en: 'Read the Wind', th: 'อ่านลม' },
          description: { en: 'You know what is coming before it arrives.', th: 'คุณรู้ว่าอะไรกำลังมาก่อนที่มันจะถึง' },
          kind: 'utility', effect: edge('wis', 3), range: 0, usesPerRest: 0,
        },
      },
      {
        id: 'ash_eater',
        name: { en: 'Ash-Eater', th: 'ผู้กลืนเถ้า' },
        description: {
          en: 'Whatever you ate the ashes of should have stayed burned, and you know it.',
          th: 'ไม่ว่าคุณกลืนเถ้าของอะไรไป มันควรจะถูกเผาทิ้งไปแล้ว และคุณก็รู้',
        },
        opens: 'blackMagic',
        grants: {
          name: { en: 'Ash Breath', th: 'ลมหายใจเถ้า' },
          description: { en: 'Everything in front of you, and some of you.', th: 'ทุกอย่างที่อยู่ตรงหน้า และบางส่วนของคุณ' },
          kind: 'combat', effect: burst(7, 1), range: 3, usesPerRest: 1,
        },
      },
    ],
  },
  {
    id: 'ranger',
    name: { en: 'Ranger', th: 'พราน' },
    description: {
      en: 'You know how far away things are, and how long food lasts.',
      th: 'คุณรู้ว่าอะไรอยู่ไกลแค่ไหน และเสบียงอยู่ได้นานเท่าไหร่',
    },
    hitDie: 10,
    primary: 'dex',
    secondary: 'wis',
    core: ['bow', 'survival'],
    affinity: ['wisdom', 'shadow'],
    forbidden: ['blackMagic', 'flame'],
    startingAttack: weapon('atk_longbow', 'longbow', 'dex', 8, 12, 'piercing'),
    startingArmour: 12,
    subclasses: [
      {
        id: 'deep_hunter',
        name: { en: 'Hunter of the Deep Floors', th: 'พรานชั้นลึก' },
        description: {
          en: 'You went deep enough, often enough, that the deep things stopped being strangers.',
          th: 'คุณลงไปลึกพอ และบ่อยพอ จนสิ่งที่อยู่ข้างล่างไม่ใช่คนแปลกหน้าอีกต่อไป',
        },
        opens: 'blackMagic',
        grants: {
          name: { en: 'Marked Quarry', th: 'เหยื่อที่ถูกหมาย' },
          description: { en: 'It only has to break the skin.', th: 'แค่ให้เข้าเนื้อก็พอ' },
          kind: 'combat', effect: hinder('poisoned', 3), range: 8, usesPerRest: 2,
        },
      },
      {
        id: 'warden',
        name: { en: 'Warden of the Stair', th: 'ผู้เฝ้าบันได' },
        description: {
          en: 'Somebody has to hold the way back down, and you do it by the light you set yourself.',
          th: 'ต้องมีใครสักคนกันทางลงไว้ และคุณทำมันด้วยแสงไฟที่คุณจุดเอง',
        },
        opens: 'flame',
        grants: {
          name: { en: 'Set Against', th: 'ตั้งรับ' },
          description: { en: 'They come to you, on your terms.', th: 'ให้เขาเข้ามาหา ในเงื่อนไขของคุณ' },
          kind: 'combat', effect: hinder('restrained', 2), range: 4, usesPerRest: 2,
        },
      },
    ],
  },
  {
    id: 'rogue',
    name: { en: 'Rogue', th: 'นักย่องเบา' },
    description: {
      en: 'You get in, and the getting out is already planned.',
      th: 'คุณเข้าไปได้ และวางแผนทางออกไว้แล้ว',
    },
    hitDie: 8,
    primary: 'dex',
    secondary: 'cha',
    core: ['shadow', 'guile'],
    affinity: ['bow', 'venom'],
    forbidden: ['guard', 'flame', 'song'],
    startingAttack: weapon('atk_longknife', 'long knife', 'dex', 6, 1, 'piercing'),
    startingArmour: 12,
    subclasses: [
      {
        // Id kept as `poisoner` although it opens the fire now: `sheet.subclassId`
        // stores it, so renaming the id would orphan every character who chose
        // it. The instinct is the same one either way — something quiet left
        // behind that does the work long after you have gone.
        id: 'poisoner',
        name: { en: 'The Quiet Fire', th: 'ไฟเงียบ' },
        description: {
          en: 'Nothing you do kills quickly. Almost everything kills.',
          th: 'ไม่มีอะไรที่คุณทำฆ่าได้เร็ว แต่เกือบทุกอย่างฆ่าได้',
        },
        opens: 'flame',
        grants: {
          name: { en: 'The Slow Cup', th: 'ถ้วยช้า' },
          description: { en: 'They will not notice until the stairs.', th: 'เขาจะไม่รู้ตัวจนกว่าจะถึงบันได' },
          kind: 'combat', effect: hinder('poisoned', 4), range: 1, usesPerRest: 2,
        },
      },
      {
        id: 'confidence',
        name: { en: 'Confidence', th: 'นักต้มตุ๋น' },
        description: {
          en: 'Doors open for you. People check their purses afterwards.',
          th: 'ประตูเปิดให้คุณ แล้วผู้คนก็คลำกระเป๋าตัวเองทีหลัง',
        },
        opens: 'song',
        grants: {
          name: { en: 'The Right Name', th: 'ชื่อที่ถูก' },
          description: { en: 'You knew who to say you were.', th: 'คุณรู้ว่าต้องบอกว่าตัวเองเป็นใคร' },
          kind: 'social', effect: edge('cha', 3), range: 0, usesPerRest: 0,
        },
      },
    ],
  },
  {
    id: 'wizard',
    name: { en: 'Wizard', th: 'นักเวท' },
    description: {
      en: 'You read your way here. It is not the same as being ready for it.',
      th: 'คุณอ่านมาจนถึงตรงนี้ ซึ่งไม่เหมือนกับการพร้อมรับมือ',
    },
    hitDie: 6,
    primary: 'int',
    secondary: 'wis',
    core: ['magic', 'flame'],
    affinity: ['wisdom', 'venom'],
    forbidden: ['sword', 'guard', 'blackMagic'],
    startingAttack: weapon('atk_staff', 'walking staff', 'int', 6, 1, 'bludgeoning'),
    startingArmour: null,
    subclasses: [
      {
        id: 'abjurer',
        name: { en: 'Abjurer', th: 'นักป้องกัน' },
        description: {
          en: 'You learned the figures that keep things out. It took longer.',
          th: 'คุณเรียนอักขระที่กันสิ่งต่าง ๆ ไว้ข้างนอก มันใช้เวลานานกว่า',
        },
        opens: 'guard',
        grants: {
          name: { en: 'Closed Figure', th: 'อักขระปิด' },
          description: { en: 'Nothing crosses a line you have finished drawing.', th: 'ไม่มีอะไรข้ามเส้นที่คุณวาดจบแล้ว' },
          kind: 'combat', effect: mend(8), range: 0, usesPerRest: 2,
        },
      },
      {
        id: 'transcriber',
        name: { en: 'Transcriber', th: 'ผู้คัดลอก' },
        description: {
          en: 'You copied out the pages nobody was supposed to copy.',
          th: 'คุณคัดลอกหน้าที่ไม่มีใครควรคัดลอก',
        },
        opens: 'blackMagic',
        grants: {
          name: { en: 'The Bad Page', th: 'หน้าที่ไม่ควรอ่าน' },
          description: { en: 'It works. That was never the question.', th: 'มันได้ผล นั่นไม่เคยเป็นคำถาม' },
          kind: 'combat', effect: strike(8), range: 4, usesPerRest: 1,
        },
      },
    ],
  },
  {
    id: 'warlock',
    name: { en: 'Warlock', th: 'ผู้ทำสัญญา' },
    description: {
      en: 'You agreed to something. It has been very patient about collecting.',
      th: 'คุณตกลงอะไรบางอย่างไว้ และมันก็อดทนรอเก็บมาก',
    },
    hitDie: 8,
    primary: 'int',
    secondary: 'cha',
    core: ['blackMagic', 'venom'],
    affinity: ['magic', 'shadow'],
    forbidden: ['guard', 'song', 'flame'],
    startingAttack: weapon('atk_ritual_knife', 'ritual knife', 'int', 6, 1, 'piercing'),
    startingArmour: null,
    subclasses: [
      {
        id: 'pact_voice',
        name: { en: 'Pact of the Voice', th: 'สัญญาแห่งเสียง' },
        description: {
          en: 'It speaks through you now, and people listen.',
          th: 'ตอนนี้มันพูดผ่านคุณ และผู้คนก็ฟัง',
        },
        opens: 'song',
        grants: {
          name: { en: 'Borrowed Mouth', th: 'ปากที่ยืมมา' },
          description: { en: 'The words are not yours. They work anyway.', th: 'คำพวกนั้นไม่ใช่ของคุณ แต่มันก็ได้ผล' },
          kind: 'social', effect: edge('cha', 3), range: 0, usesPerRest: 0,
        },
      },
      {
        id: 'pact_ember',
        name: { en: 'Pact of the Ember', th: 'สัญญาแห่งถ่านไฟ' },
        description: {
          en: 'What it gives you burns on the way out.',
          th: 'สิ่งที่มันให้คุณ เผาไหม้ตอนออกมา',
        },
        opens: 'flame',
        grants: {
          name: { en: 'Given Freely', th: 'ให้โดยไม่หวง' },
          description: { en: 'It does not know which of you it was aimed at.', th: 'มันไม่รู้ว่าถูกเล็งไปที่ใครในหมู่พวกคุณ' },
          kind: 'combat', effect: burst(8, 2), range: 5, usesPerRest: 1,
        },
      },
    ],
  },
  {
    id: 'oracle',
    name: { en: 'Oracle', th: 'ผู้หยั่งรู้' },
    description: {
      en: 'People bring you their questions. You have stopped enjoying the answers.',
      th: 'ผู้คนเอาคำถามมาให้คุณ และคุณก็เลิกสนุกกับคำตอบแล้ว',
    },
    hitDie: 8,
    primary: 'wis',
    secondary: 'cha',
    core: ['wisdom', 'song'],
    affinity: ['guard', 'magic'],
    forbidden: ['shadow', 'blackMagic', 'flame'],
    startingAttack: weapon('atk_censer', 'weighted censer', 'wis', 6, 1, 'bludgeoning'),
    startingArmour: 12,
    subclasses: [
      {
        id: 'grave_touched',
        name: { en: 'Grave-Touched', th: 'ผู้ถูกหลุมศพแตะ' },
        description: {
          en: 'Something answered that should not have been listening.',
          th: 'มีบางอย่างตอบกลับมา ทั้งที่ไม่ควรจะฟังอยู่',
        },
        opens: 'blackMagic',
        grants: {
          name: { en: 'What Answered', th: 'สิ่งที่ตอบกลับ' },
          description: { en: 'You did not ask it to help. It helps.', th: 'คุณไม่ได้ขอให้มันช่วย แต่มันก็ช่วย' },
          kind: 'combat', effect: strike(7), range: 4, usesPerRest: 2,
        },
      },
      {
        id: 'lantern',
        name: { en: 'Lantern-Keeper', th: 'ผู้ดูแลตะเกียง' },
        description: {
          en: 'You keep the light going, and the light keeps going.',
          th: 'คุณดูแลให้แสงไม่ดับ และแสงก็ไม่ดับ',
        },
        opens: 'flame',
        grants: {
          name: { en: 'Kept Light', th: 'แสงที่รักษาไว้' },
          description: { en: 'Bright enough to reach the corners.', th: 'สว่างพอจะถึงมุมห้อง' },
          kind: 'combat', effect: burst(5, 2), range: 5, usesPerRest: 2,
        },
      },
    ],
  },
  {
    id: 'bard',
    name: { en: 'Bard', th: 'กวี' },
    description: {
      en: 'You are here for the story, and you are prepared to be in it.',
      th: 'คุณมาเพื่อเรื่องเล่า และพร้อมจะเป็นส่วนหนึ่งของมัน',
    },
    hitDie: 8,
    primary: 'cha',
    secondary: 'dex',
    core: ['song', 'guile'],
    affinity: ['wisdom', 'shadow'],
    forbidden: ['guard', 'flame', 'bow', 'magic'],
    startingAttack: weapon('atk_rapier', 'rapier', 'dex', 8, 1, 'piercing'),
    startingArmour: 12,
    subclasses: [
      {
        id: 'skirmisher',
        name: { en: 'Skirmisher', th: 'นักรบเบา' },
        description: {
          en: 'You learned to sing from further away.',
          th: 'คุณเรียนร้องเพลงจากที่ไกลขึ้น',
        },
        opens: 'bow',
        grants: {
          name: { en: 'Parting Note', th: 'โน้ตอำลา' },
          description: { en: 'Something to remember you by.', th: 'บางอย่างให้จำคุณได้' },
          kind: 'combat', effect: strike(6), range: 8, usesPerRest: 2,
        },
      },
      {
        id: 'chronicler',
        name: { en: 'Chronicler', th: 'ผู้บันทึก' },
        description: {
          en: 'You have been writing all of it down, including the parts nobody wanted written.',
          th: 'คุณจดทุกอย่างไว้ รวมถึงส่วนที่ไม่มีใครอยากให้จด',
        },
        opens: 'magic',
        grants: {
          name: { en: 'Marginalia', th: 'บันทึกริมหน้า' },
          description: { en: 'You wrote down what it did last time.', th: 'คุณจดไว้ว่าคราวก่อนมันทำอะไร' },
          kind: 'utility', effect: edge('int', 3), range: 0, usesPerRest: 0,
        },
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Looking one up                                                              */
/* -------------------------------------------------------------------------- */

export const classById = (id: string | undefined): CharacterClass | null =>
  CLASSES.find((c) => c.id === id) ?? null;

export function subclassById(classId: string | undefined, subclassId: string | undefined): Subclass | null {
  const held = classById(classId);
  if (!held || !subclassId) return null;
  return held.subclasses.find((s) => s.id === subclassId) ?? null;
}

/** The level a subclass becomes available. Familiar, and early enough to shape a build. */
export const SUBCLASS_LEVEL = 3;

export const canChooseSubclass = (level: number, classId?: string, subclassId?: string): boolean =>
  level >= SUBCLASS_LEVEL && Boolean(classById(classId)) && !subclassId;

/** Turn a subclass's spec into a real skill, with an id stable across sessions. */
export function subclassSkill(sub: Subclass, language: 'th' | 'en'): ActiveSkill {
  return {
    id: `subclass_${sub.id}`,
    name: sub.grants.name[language],
    description: sub.grants.description[language],
    kind: sub.grants.kind,
    ability: sub.grants.effect.kind === 'edge' ? sub.grants.effect.ability : 'str',
    effect: sub.grants.effect,
    range: sub.grants.range,
    usesPerRest: sub.grants.usesPerRest,
  };
}
