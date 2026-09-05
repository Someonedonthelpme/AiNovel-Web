import { mulberry32 } from '../engine/roll.ts';
import { subjectsFor } from '../world/subjects.ts';
import type { Subject } from '../world/subjects.ts';
import type { Item } from '../items/types.ts';
import type { Lore } from './lore.ts';

/**
 * The histories things carry.
 *
 * Derived from the item and the world seed rather than stored, exactly like
 * traits, Signets, paths and the class roster. A sword found on floor nine has
 * the same history on a replay as it did when it dropped, and none of it has
 * to travel in the save.
 *
 * NOT EVERYTHING HAS A HISTORY, and that is the point. If every object came
 * with a paragraph, reading them would be a chore and none of them would mean
 * anything. Most things are just things.
 *
 * `ponytail: keyed on the item TYPE, so every axe of a make shares a history.
 * A history properly belongs to ONE object — `ItemInstance.lore` is where it
 * goes — but instances are not in the inventory yet. Reads as "axes of this
 * make were forged in X" until step 5 moves it.`
 */

/** How often a thing turns out to have a story attached. */
export const LORE_CHANCE = 0.35;

/** Words that carry a history without naming a setting. */
const OPENINGS = {
  en: [
    'It was carried out of', 'It was made for', 'It changed hands after',
    'It was buried with somebody who knew', 'The maker’s mark ties it to',
    'It was payment for', 'It was taken from',
  ],
  th: [
    'มันถูกนำออกมาจาก', 'มันถูกทำขึ้นเพื่อ', 'มันเปลี่ยนมือหลังจาก',
    'มันถูกฝังไปพร้อมคนที่รู้เรื่อง', 'รอยช่างบอกว่ามันมาจาก',
    'มันเคยเป็นค่าตอบแทนของ', 'มันถูกยึดมาจาก',
  ],
} as const;

const CLOSINGS = {
  en: [
    'and nobody has asked for it back.', 'and the story is not a kind one.',
    'and whoever held it last did not keep it long.', 'and that is most of what is known.',
    'and the rest was not written down.',
  ],
  th: [
    'และไม่มีใครมาทวงคืน', 'และเรื่องมันไม่ได้สวยงาม',
    'และคนที่ถือมันคนสุดท้ายก็ถือได้ไม่นาน', 'และนั่นคือเกือบทั้งหมดที่รู้กัน',
    'และที่เหลือไม่มีใครบันทึกไว้',
  ],
} as const;

const pick = <T,>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * What this thing's history is, if it has one.
 *
 * Seeded from the item's own id and the world, so the same object always
 * carries the same story — the keying every generated thing here uses, for the
 * reason a node taken at level four must still teach the same skill at twelve.
 *
 * DEPTH COMES OFF DEPTH. Something dragged up from floor twenty carries more of
 * a story than something found in the first room, which is what makes a deep
 * find worth reading rather than just worth more.
 */
export function loreFor(item: Item, seed: number, language: 'th' | 'en' = 'en'): Lore | null {
  const subjects = subjectsFor(seed);
  if (subjects.length === 0) return null;

  const rng = mulberry32((hash(item.id) ^ seed) >>> 0);
  if (rng() > LORE_CHANCE) return null;

  const floor = item.foundOn ?? 0;
  const depth = Math.max(1, Math.min(3, 1 + Math.floor(floor / 8) + (rng() < 0.2 ? 1 : 0)));

  // One subject usually, two for the deepest finds — a story that touches two
  // things a person cares about is rare enough to be worth the walk.
  const about: Subject[] = [pick(rng, subjects)];
  if (depth >= 3 && subjects.length > 1) {
    const second = pick(rng, subjects.filter((s) => s.id !== about[0].id));
    if (second) about.push(second);
  }

  const opening = pick(rng, OPENINGS[language]);
  const closing = pick(rng, CLOSINGS[language]);
  const named = about.map((s) => s.name).join(language === 'th' ? ' และ ' : ' and ');

  return {
    id: `lore_${item.id}`,
    text: `${opening} ${named}, ${closing}`,
    about: about.map((s) => s.id),
    depth,
  };
}

export const hasLore = (item: Item, seed: number): boolean => loreFor(item, seed) !== null;
