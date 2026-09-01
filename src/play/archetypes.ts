import type { Ability, Condition } from '../combat/types.ts';
import type { ActiveEffect, ActiveKind, ActiveSkill } from '../skills/active.ts';

/**
 * The disciplines the passive tree is built out of.
 *
 * The first tree was six anonymous spokes of "+1 str", which is a tree in shape
 * only — nothing about a route said what kind of character you were becoming.
 * These do: each is a discipline with a name, an ability it leans on, and two
 * ACTIVE skills it teaches along the way, so walking a branch changes what you
 * can do and not merely what your numbers are.
 *
 * Written by hand rather than generated. Eight of them is few enough to author,
 * and a generator assembling "Black Magic" out of parts produces something that
 * reads like a spreadsheet. The tree's LAYOUT is still generated per seed, so
 * two characters never walk the same map.
 */

export type ArchetypeId =
  | 'sword' | 'bow' | 'guard' | 'wisdom'
  | 'magic' | 'blackMagic' | 'guile' | 'survival';

type Bilingual = { en: string; th: string };

export type Archetype = {
  id: ArchetypeId;
  name: Bilingual;
  /** What the whole branch leans on. */
  ability: Ability;
  /** A second ability its later nodes also feed. */
  secondary: Ability;
  /** Node names, in order of depth. Enough for six rings. */
  minors: Bilingual[];
  notables: Bilingual[];
  keystone: Bilingual;
  /** The trade a keystone makes — it must cost something. */
  keystoneNote: Bilingual;
  /** The two actives this discipline teaches, at its notables. */
  teaches: [SkillSpec, SkillSpec];
};

type SkillSpec = {
  name: Bilingual;
  description: Bilingual;
  kind: ActiveKind;
  effect: ActiveEffect;
  range: number;
  usesPerRest: number;
};

const hinder = (condition: Condition, rounds: number): ActiveEffect => ({ kind: 'hinder', condition, rounds });
const edge = (ability: Ability, bonus: number): ActiveEffect => ({ kind: 'edge', ability, bonus });

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: 'sword',
    name: { en: 'The Sword', th: 'วิถีดาบ' },
    ability: 'str',
    secondary: 'con',
    minors: [
      { en: 'Grip', th: 'การจับ' },
      { en: 'Footwork', th: 'ฝีเท้า' },
      { en: 'Weight', th: 'น้ำหนัก' },
      { en: 'Follow-Through', th: 'การส่งแรง' },
    ],
    notables: [
      { en: 'Hand and Edge', th: 'มือกับคม' },
      { en: 'The Long Line', th: 'เส้นยาว' },
    ],
    keystone: { en: 'Nothing Held Back', th: 'ไม่เหลือไว้' },
    keystoneNote: {
      en: 'Every swing is the last one. You hit far harder, and you break far sooner.',
      th: 'ทุกครั้งที่ฟันคือครั้งสุดท้าย ตีหนักขึ้นมาก แต่ก็ล้มง่ายขึ้นมาก',
    },
    teaches: [
      {
        name: { en: 'Sweep', th: 'กวาด' },
        description: { en: 'Take their legs before they set them.', th: 'ตัดขาก่อนที่เขาจะตั้งหลัก' },
        kind: 'combat', effect: hinder('prone', 2), range: 1, usesPerRest: 2,
      },
      {
        name: { en: 'Riposte', th: 'สวนกลับ' },
        description: { en: 'Answer the opening they gave you.', th: 'ตอบช่องว่างที่เขาเปิดให้' },
        kind: 'combat', effect: hinder('stunned', 1), range: 1, usesPerRest: 1,
      },
    ],
  },
  {
    id: 'bow',
    name: { en: 'The Bow', th: 'วิถีธนู' },
    ability: 'dex',
    secondary: 'wis',
    minors: [
      { en: 'Draw', th: 'การน้าว' },
      { en: 'Breath', th: 'ลมหายใจ' },
      { en: 'Windage', th: 'ทิศลม' },
      { en: 'Stillness', th: 'ความนิ่ง' },
    ],
    notables: [
      { en: 'Eye and String', th: 'ตากับสาย' },
      { en: 'The Held Shot', th: 'ลูกที่รอ' },
    ],
    keystone: { en: 'Distance Is Mercy', th: 'ระยะคือความเมตตา' },
    keystoneNote: {
      en: 'You are deadly at range and useless in a press.',
      th: 'ร้ายกาจในระยะไกล และไร้ประโยชน์เมื่อถูกประชิด',
    },
    teaches: [
      {
        name: { en: 'Pinning Shot', th: 'ยิงตรึง' },
        description: { en: 'Put an arrow where their foot was going.', th: 'ปักลูกไว้ตรงที่เท้าเขากำลังจะไป' },
        kind: 'combat', effect: hinder('restrained', 2), range: 6, usesPerRest: 2,
      },
      {
        name: { en: 'Blinding Shaft', th: 'ลูกบดบัง' },
        description: { en: 'Not fatal. Worse.', th: 'ไม่ถึงตาย แต่แย่กว่านั้น' },
        kind: 'combat', effect: hinder('blinded', 2), range: 6, usesPerRest: 1,
      },
    ],
  },
  {
    id: 'guard',
    name: { en: 'The Shield', th: 'วิถีโล่' },
    ability: 'con',
    secondary: 'str',
    minors: [
      { en: 'Stance', th: 'การตั้งท่า' },
      { en: 'Wind', th: 'ลมปราณ' },
      { en: 'Scar Tissue', th: 'เนื้อแผลเป็น' },
      { en: 'Set Feet', th: 'ปักเท้า' },
    ],
    notables: [
      { en: 'The Held Line', th: 'แนวที่ไม่ถอย' },
      { en: 'Second Wind', th: 'ลมที่สอง' },
    ],
    keystone: { en: 'Immovable', th: 'ไม่ขยับ' },
    keystoneNote: {
      en: 'Nothing gets through you. Nothing much gets past you either.',
      th: 'ไม่มีอะไรผ่านคุณไปได้ และคุณก็ไล่ตามใครแทบไม่ทัน',
    },
    teaches: [
      {
        name: { en: 'Brace', th: 'ยันไว้' },
        description: { en: 'Get back up before they notice you fell.', th: 'ลุกขึ้นก่อนที่เขาจะทันเห็นว่าคุณล้ม' },
        kind: 'combat', effect: { kind: 'rally', condition: 'prone' }, range: 0, usesPerRest: 3,
      },
      {
        name: { en: 'Second Wind', th: 'ลมที่สอง' },
        description: { en: 'You have more left than you thought.', th: 'คุณยังเหลือมากกว่าที่คิด' },
        kind: 'combat', effect: { kind: 'mend', amount: 8 }, range: 0, usesPerRest: 1,
      },
    ],
  },
  {
    id: 'wisdom',
    name: { en: 'The Long Look', th: 'วิถีการมอง' },
    ability: 'wis',
    secondary: 'int',
    minors: [
      { en: 'Attention', th: 'ความใส่ใจ' },
      { en: 'Patience', th: 'ความอดทน' },
      { en: 'Sign-Reading', th: 'การอ่านร่องรอย' },
      { en: 'Quiet', th: 'ความเงียบ' },
    ],
    notables: [
      { en: 'What the Ground Says', th: 'สิ่งที่พื้นบอก' },
      { en: 'Before It Happens', th: 'ก่อนที่มันจะเกิด' },
    ],
    keystone: { en: 'You Saw It Coming', th: 'คุณเห็นมันมาแต่ไกล' },
    keystoneNote: {
      en: 'Little surprises you, and you have stopped being surprising.',
      th: 'แทบไม่มีอะไรทำให้คุณประหลาดใจ และคุณก็เลิกทำให้ใครประหลาดใจแล้ว',
    },
    teaches: [
      {
        name: { en: 'Read the Ground', th: 'อ่านพื้น' },
        description: { en: 'The floor has been telling you things.', th: 'พื้นบอกอะไรคุณมาตลอด' },
        kind: 'utility', effect: edge('wis', 2), range: 0, usesPerRest: 0,
      },
      {
        name: { en: 'Weigh the Room', th: 'ชั่งใจห้อง' },
        description: { en: 'You know who is going to move first.', th: 'คุณรู้ว่าใครจะขยับก่อน' },
        kind: 'utility', effect: edge('int', 2), range: 0, usesPerRest: 0,
      },
    ],
  },
  {
    id: 'magic',
    name: { en: 'The Figure', th: 'วิถีอักขระ' },
    ability: 'int',
    secondary: 'wis',
    minors: [
      { en: 'Notation', th: 'สัญลักษณ์' },
      { en: 'Recall', th: 'ความจำ' },
      { en: 'The Second Reading', th: 'การอ่านครั้งที่สอง' },
      { en: 'Clean Hands', th: 'มือสะอาด' },
    ],
    notables: [
      { en: 'Working Knowledge', th: 'ความรู้ที่ใช้ได้' },
      { en: 'The Closed Figure', th: 'อักขระปิด' },
    ],
    keystone: { en: 'Everything Is Written', th: 'ทุกสิ่งถูกเขียนไว้' },
    keystoneNote: {
      en: 'You understand more than anyone should, and your hands have gone soft.',
      th: 'คุณเข้าใจมากเกินกว่าที่ใครควรเข้าใจ และมือของคุณก็อ่อนแรงลง',
    },
    teaches: [
      {
        name: { en: 'Binding Figure', th: 'อักขระตรึง' },
        description: { en: 'Draw it fast and it holds. Mostly.', th: 'วาดให้ไว แล้วมันจะตรึงอยู่ ส่วนใหญ่' },
        kind: 'combat', effect: hinder('restrained', 2), range: 4, usesPerRest: 2,
      },
      {
        name: { en: 'Mending Figure', th: 'อักขระสมาน' },
        description: { en: 'Closes what it is drawn over.', th: 'ปิดสิ่งที่มันถูกวาดทับ' },
        kind: 'combat', effect: { kind: 'mend', amount: 7 }, range: 0, usesPerRest: 2,
      },
    ],
  },
  {
    id: 'blackMagic',
    name: { en: 'The Cost', th: 'วิถีราคา' },
    ability: 'int',
    secondary: 'cha',
    minors: [
      { en: 'The Bad Page', th: 'หน้าที่ไม่ควรอ่าน' },
      { en: 'Sleeplessness', th: 'การไม่หลับ' },
      { en: 'What It Takes', th: 'สิ่งที่ต้องจ่าย' },
      { en: 'Practice', th: 'การฝึก' },
    ],
    notables: [
      { en: 'Willing to Pay', th: 'ยอมจ่าย' },
      { en: 'The Open Mouth', th: 'ปากที่เปิดอยู่' },
    ],
    keystone: { en: 'It Takes and It Gives', th: 'มันเอาไป และมันให้มา' },
    keystoneNote: {
      en: 'Power, and something of yours goes with every use of it.',
      th: 'พลัง และบางอย่างของคุณหายไปทุกครั้งที่ใช้',
    },
    teaches: [
      {
        name: { en: 'Wither', th: 'เหี่ยว' },
        description: { en: 'They go grey and slow. It costs you sleep.', th: 'เขาจะซีดและช้าลง แลกกับการนอนของคุณ' },
        kind: 'combat', effect: hinder('poisoned', 3), range: 4, usesPerRest: 2,
      },
      {
        name: { en: 'Unmaking Word', th: 'คำที่ไม่ควรพูด' },
        description: { en: 'One word. They stop.', th: 'คำเดียว เขาจะหยุด' },
        kind: 'combat', effect: hinder('stunned', 1), range: 5, usesPerRest: 1,
      },
    ],
  },
  {
    id: 'guile',
    name: { en: 'The Quiet Word', th: 'วิถีคำเบา' },
    ability: 'cha',
    secondary: 'dex',
    minors: [
      { en: 'Listening', th: 'การฟัง' },
      { en: 'Timing', th: 'จังหวะ' },
      { en: 'A Straight Face', th: 'หน้าตาย' },
      { en: 'The Right Name', th: 'ชื่อที่ถูก' },
    ],
    notables: [
      { en: 'What They Want', th: 'สิ่งที่เขาต้องการ' },
      { en: 'The Useful Lie', th: 'คำโกหกที่มีประโยชน์' },
    ],
    keystone: { en: 'Everyone Owes Someone', th: 'ทุกคนติดหนี้ใครสักคน' },
    keystoneNote: {
      en: 'Doors open for you. People check their purses afterwards.',
      th: 'ประตูเปิดให้คุณ แล้วผู้คนก็คลำกระเป๋าตัวเองทีหลัง',
    },
    teaches: [
      {
        name: { en: 'The Quiet Word', th: 'คำเบา' },
        description: { en: 'You know what to say to this one.', th: 'คุณรู้ว่าจะพูดอะไรกับคนแบบนี้' },
        kind: 'social', effect: edge('cha', 2), range: 0, usesPerRest: 0,
      },
      {
        name: { en: 'Sleight', th: 'มือไว' },
        description: { en: 'It was in your hand the whole time.', th: 'มันอยู่ในมือคุณมาตลอด' },
        kind: 'utility', effect: edge('dex', 2), range: 0, usesPerRest: 0,
      },
    ],
  },
  {
    id: 'survival',
    name: { en: 'The Long Walk', th: 'วิถีเดินไกล' },
    ability: 'con',
    secondary: 'wis',
    minors: [
      { en: 'Rations', th: 'เสบียง' },
      { en: 'Cold Nights', th: 'คืนหนาว' },
      { en: 'Water Sense', th: 'สัมผัสน้ำ' },
      { en: 'Hard Sleep', th: 'หลับบนหิน' },
    ],
    notables: [
      { en: 'Made It Back', th: 'กลับมาได้' },
      { en: 'Nothing Wasted', th: 'ไม่มีอะไรสูญเปล่า' },
    ],
    keystone: { en: 'You Keep Walking', th: 'คุณเดินต่อ' },
    keystoneNote: {
      en: 'You outlast anything. You overwhelm nothing.',
      th: 'คุณอยู่ได้นานกว่าทุกอย่าง แต่ไม่ชนะอะไรได้เร็ว',
    },
    teaches: [
      {
        name: { en: 'Field Dressing', th: 'ปฐมพยาบาล' },
        description: { en: 'Not clean. Enough.', th: 'ไม่สะอาด แต่พอ' },
        kind: 'combat', effect: { kind: 'mend', amount: 5 }, range: 0, usesPerRest: 3,
      },
      {
        name: { en: 'Forage', th: 'หาของกิน' },
        description: { en: 'There is always something.', th: 'มีอะไรให้กินเสมอ' },
        kind: 'utility', effect: edge('con', 2), range: 0, usesPerRest: 0,
      },
    ],
  },
];

/** The discipline a background most resembles, for where its tree opens. */
export function archetypeForBackground(backgroundId: string): ArchetypeId {
  const id = backgroundId.toLowerCase();
  const guesses: [RegExp, ArchetypeId][] = [
    [/scholar|clerk|scribe|student|librar/, 'magic'],
    [/witch|warlock|cult|heretic|necro/, 'blackMagic'],
    [/hunt|ranger|scout|archer|poach/, 'bow'],
    [/guard|soldier|knight|warden|watch/, 'guard'],
    [/thief|rogue|smuggl|trader|merchant|dock/, 'guile'],
    [/priest|monk|seer|oracle|healer/, 'wisdom'],
    [/sailor|farmer|labour|labor|miner|fisher/, 'survival'],
  ];
  for (const [pattern, archetype] of guesses) if (pattern.test(id)) return archetype;
  return 'sword';
}

/** Turn a spec into a real skill, with an id stable across sessions. */
export function skillFrom(archetype: Archetype, which: 0 | 1, language: 'th' | 'en'): ActiveSkill {
  const spec = archetype.teaches[which];
  return {
    id: `tree_${archetype.id}_${which}`,
    name: spec.name[language],
    description: spec.description[language],
    kind: spec.kind,
    ability: spec.kind === 'combat' ? archetype.ability : archetype.secondary,
    effect: spec.effect,
    range: spec.range,
    usesPerRest: spec.usesPerRest,
  };
}
