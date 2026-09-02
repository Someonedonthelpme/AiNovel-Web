import type { Ability, Condition } from '../combat/types.ts';
import type { ActiveEffect, ActiveKind, ActiveSkill } from '../skills/active.ts';
import type { Grammar } from '../skills/compose.ts';

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
  | 'magic' | 'blackMagic' | 'guile' | 'survival'
  | 'flame' | 'venom' | 'shadow' | 'song';

export type Bilingual = { en: string; th: string };

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
  /**
   * What a GENERATED skill of this discipline may be built from.
   *
   * Balance is the easy half of generation; coherence is the hard one. Without
   * this a composer will happily produce a bow that heals or a shield that sets
   * a room on fire — legal, correctly priced, and belonging nowhere.
   */
  draws: Grammar;
};

export type SkillSpec = {
  name: Bilingual;
  description: Bilingual;
  kind: ActiveKind;
  effect: ActiveEffect;
  range: number;
  usesPerRest: number;
};

const hinder = (condition: Condition, rounds: number): ActiveEffect => ({ kind: 'hinder', condition, rounds });
const edge = (ability: Ability, bonus: number): ActiveEffect => ({ kind: 'edge', ability, bonus });
const strike = (damage: number): ActiveEffect => ({ kind: 'strike', damage });
const drain = (damage: number, heal: number): ActiveEffect => ({ kind: 'drain', damage, heal });
const burst = (damage: number, radius: number): ActiveEffect => ({ kind: 'burst', damage, radius });
const hex = (damage: number, condition: Condition, rounds: number): ActiveEffect =>
  ({ kind: 'hex', damage, condition, rounds });

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
    draws: { payloads: ['strike', 'hinder', 'rally'], conditions: ['prone', 'stunned'], maxRange: 1 },
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
    draws: { payloads: ['strike', 'hinder'], conditions: ['restrained', 'blinded', 'prone'], maxRange: 8 },
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
    draws: { payloads: ['rally', 'mend', 'hinder'], conditions: ['prone', 'grappled'], maxRange: 1 },
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
    draws: { payloads: ['edge', 'hinder', 'rally'], conditions: ['blinded', 'prone'], maxRange: 3 },
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
    draws: { payloads: ['hinder', 'mend', 'strike'], conditions: ['restrained', 'stunned'], maxRange: 5 },
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
    draws: { payloads: ['drain', 'hex', 'strike'], conditions: ['poisoned', 'stunned', 'blinded'], maxRange: 5 },
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
    draws: { payloads: ['edge', 'hinder'], conditions: ['prone', 'blinded'], maxRange: 2 },
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
    draws: { payloads: ['mend', 'rally', 'edge'], conditions: ['prone', 'poisoned'], maxRange: 1 },
  },
  {
    id: 'flame',
    name: { en: 'The Kindling', th: 'วิถีไฟ' },
    ability: 'int',
    secondary: 'cha',
    minors: [
      { en: 'Tinder', th: 'เชื้อไฟ' },
      { en: 'Draught', th: 'ลมเข้า' },
      { en: 'Heat Haze', th: 'ไอร้อน' },
      { en: 'Ash', th: 'ขี้เถ้า' },
    ],
    notables: [
      { en: 'Catch and Spread', th: 'ติดแล้วลาม' },
      { en: 'The Whole Room', th: 'ทั้งห้อง' },
    ],
    keystone: { en: 'It Does Not Choose', th: 'มันไม่เลือก' },
    keystoneNote: {
      en: 'Fire does not know which of you it was aimed at.',
      th: 'ไฟไม่รู้ว่ามันถูกเล็งไปที่ใครในหมู่พวกคุณ',
    },
    teaches: [
      {
        name: { en: 'Flare', th: 'ลุกวาบ' },
        description: { en: 'A short bright noise, and everything near it.', th: 'เสียงสว่างสั้น ๆ และทุกอย่างที่อยู่ใกล้' },
        kind: 'combat', effect: burst(5, 1), range: 5, usesPerRest: 2,
      },
      {
        name: { en: 'Conflagration', th: 'เพลิงลาม' },
        description: { en: 'It gets away from you. That is the point.', th: 'มันจะเกินการควบคุม นั่นแหละคือจุดประสงค์' },
        kind: 'combat', effect: burst(8, 2), range: 5, usesPerRest: 1,
      },
    ],
    draws: { payloads: ['burst', 'strike'], conditions: ['blinded'], maxRange: 6 },
  },
  {
    id: 'venom',
    name: { en: 'The Slow Cup', th: 'วิถียาพิษ' },
    ability: 'int',
    secondary: 'dex',
    minors: [
      { en: 'Measures', th: 'การตวง' },
      { en: 'A Steady Hand', th: 'มือนิ่ง' },
      { en: 'Bitterness', th: 'ความขม' },
      { en: 'Residue', th: 'ตะกอน' },
    ],
    notables: [
      { en: 'What Keeps Working', th: 'สิ่งที่ออกฤทธิ์ต่อ' },
      { en: 'The Long Dose', th: 'ปริมาณที่ค้างอยู่' },
    ],
    keystone: { en: 'Patience Is a Weapon', th: 'ความอดทนคืออาวุธ' },
    keystoneNote: {
      en: 'Nothing you do kills quickly, and almost everything kills.',
      th: 'ไม่มีสิ่งใดที่คุณทำฆ่าได้เร็ว แต่เกือบทุกอย่างฆ่าได้',
    },
    teaches: [
      {
        name: { en: 'Coat the Blade', th: 'อาบคม' },
        description: { en: 'It only has to break the skin.', th: 'แค่ให้เข้าเนื้อก็พอ' },
        kind: 'combat', effect: hex(3, 'poisoned', 3), range: 1, usesPerRest: 2,
      },
      {
        name: { en: 'Seizing Draught', th: 'ยาชัก' },
        description: { en: 'They fold before they understand why.', th: 'เขาทรุดลงก่อนจะเข้าใจว่าทำไม' },
        kind: 'combat', effect: hex(4, 'stunned', 1), range: 2, usesPerRest: 1,
      },
    ],
    draws: { payloads: ['hex', 'hinder', 'drain'], conditions: ['poisoned', 'stunned'], maxRange: 3 },
  },
  {
    id: 'shadow',
    name: { en: 'The Blind Side', th: 'วิถีเงา' },
    ability: 'dex',
    secondary: 'cha',
    minors: [
      { en: 'Soft Soles', th: 'ฝ่าเท้าเบา' },
      { en: 'Held Breath', th: 'กลั้นหายใจ' },
      { en: 'Angles', th: 'มุมอับ' },
      { en: 'The Wait', th: 'การรอ' },
    ],
    notables: [
      { en: 'Where They Are Not Looking', th: 'ที่ที่เขาไม่ได้มอง' },
      { en: 'One Motion', th: 'จังหวะเดียว' },
    ],
    keystone: { en: 'Seen Once', th: 'เห็นครั้งเดียว' },
    keystoneNote: {
      en: 'Devastating from the dark, and there is not much of you in the light.',
      th: 'ร้ายกาจเมื่ออยู่ในเงา และแทบไม่เหลืออะไรเมื่ออยู่กลางแสง',
    },
    teaches: [
      {
        name: { en: 'Quiet Cut', th: 'รอยเงียบ' },
        description: { en: 'No swing. Just the result.', th: 'ไม่มีการเหวี่ยง มีแต่ผลลัพธ์' },
        kind: 'combat', effect: strike(7), range: 1, usesPerRest: 2,
      },
      {
        name: { en: 'Take the Wind', th: 'ชิงลมหายใจ' },
        description: { en: 'You are steadier afterwards. They are not.', th: 'หลังจากนั้นคุณจะมั่นคงขึ้น ส่วนเขาไม่' },
        kind: 'combat', effect: drain(6, 4), range: 1, usesPerRest: 2,
      },
    ],
    draws: { payloads: ['strike', 'drain', 'hinder'], conditions: ['blinded', 'prone'], maxRange: 2 },
  },
  {
    id: 'song',
    name: { en: 'The Carrying Voice', th: 'วิถีเสียง' },
    ability: 'cha',
    secondary: 'wis',
    minors: [
      { en: 'Pitch', th: 'ระดับเสียง' },
      { en: 'Refrain', th: 'ท่อนซ้ำ' },
      { en: 'Carrying', th: 'เสียงไปไกล' },
      { en: 'The Old Songs', th: 'เพลงเก่า' },
    ],
    notables: [
      { en: 'Something to March To', th: 'จังหวะให้เดินตาม' },
      { en: 'A Room That Listens', th: 'ห้องที่ยอมฟัง' },
    ],
    keystone: { en: 'Everyone Remembers It', th: 'ทุกคนจำมันได้' },
    keystoneNote: {
      en: 'People do what you ask. They also remember exactly who asked.',
      th: 'ผู้คนทำตามที่คุณขอ และก็จำได้แม่นว่าใครเป็นคนขอ',
    },
    teaches: [
      {
        name: { en: 'Marching Song', th: 'เพลงเดินทัพ' },
        description: { en: 'Something to put your feet to.', th: 'บางอย่างให้ก้าวตาม' },
        kind: 'combat', effect: { kind: 'mend', amount: 6 }, range: 0, usesPerRest: 2,
      },
      {
        name: { en: 'A Room That Listens', th: 'ห้องที่ยอมฟัง' },
        description: { en: 'They were going to argue. Now they are not.', th: 'เขากำลังจะเถียง ตอนนี้ไม่แล้ว' },
        kind: 'social', effect: edge('cha', 3), range: 0, usesPerRest: 0,
      },
    ],
    draws: { payloads: ['mend', 'edge', 'rally'], conditions: ['prone', 'stunned'], maxRange: 4 },
  },
];

/**
 * The discipline a background most resembles, for where its tree opens.
 *
 * Matched against the id AND the display name: ids are generated, so a
 * "Lighthouse Keeper" can arrive as `bg_2` with everything meaningful in the
 * name. Reading only the id sent them to the sword, which is the fallback for
 * "no idea" rather than an answer.
 *
 * Order matters — the more specific patterns are tried first, since "warden of
 * the archive" is a scholar and "harbour warden" is a guard.
 */
export function archetypeForBackground(backgroundId: string, name = ''): ArchetypeId {
  const text = `${backgroundId} ${name}`.toLowerCase();
  const guesses: [RegExp, ArchetypeId][] = [
    [/witch|warlock|cult|heretic|necro|occult|blood/, 'blackMagic'],
    [/scholar|clerk|scribe|student|librar|archiv|alchem|engineer/, 'magic'],
    [/priest|monk|seer|oracle|healer|keeper|lighthouse|watchman|hermit/, 'wisdom'],
    [/hunt|ranger|scout|archer|poach|trapper|fowler/, 'bow'],
    [/guard|soldier|knight|warden|sentry|legion|marine/, 'guard'],
    [/thief|rogue|smuggl|trader|merchant|dock|courier|fence|spy/, 'guile'],
    [/sailor|farmer|labour|labor|miner|fisher|drover|porter|survivor/, 'survival'],
    [/pyro|flame|fire|kindl|ember|smith/, 'flame'],
    [/poison|venom|apothec|herbal|brewer|toxic/, 'venom'],
    [/assassin|shadow|stealth|creep|burglar|cutpurse/, 'shadow'],
    [/bard|singer|minstrel|herald|crier|poet|story/, 'song'],
    [/sword|blade|duel|mercenar|gladiat|swords/, 'sword'],
  ];
  for (const [pattern, archetype] of guesses) if (pattern.test(text)) return archetype;
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
