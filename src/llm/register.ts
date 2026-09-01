import type { MentalState, NpcVoice, Personality, Status } from '../character/persona.ts';
import { registerTrust } from '../character/persona.ts';

/**
 * The signature mechanic: the trust stat IS the language.
 *
 * Thai encodes relationship in grammar — pronoun choice and sentence-ending
 * particle shift with intimacy, status and anger. Because the engine already
 * tracks trust as a visible integer, the register can be DERIVED from it: the
 * player watches a number move and hears the language move with it, in the same
 * beat, differently for each NPC.
 *
 * This is emitted as an explicit instruction on every turn. It is never left to
 * the model's judgement — register is the first constraint a model drops.
 */

export type RegisterInstruction = {
  npc: string;
  /** How the NPC refers to themselves. */
  selfPronoun: string;
  /** How the NPC addresses the player at this trust level. */
  addressesPlayerAs: string;
  /** The sentence-ending particle at this trust level. */
  particle: string;
  tics: string[];
  trust: number;
};

/** Pick the band whose floor is the highest value not exceeding `trust`. */
export function bandFor(trust: number, bands: Record<string, string>): string | null {
  let best: { floor: number; value: string } | null = null;
  for (const [key, value] of Object.entries(bands)) {
    const floor = Number(key);
    if (!Number.isFinite(floor) || floor > trust) continue;
    if (!best || floor > best.floor) best = { floor, value };
  }
  return best ? best.value : null;
}

/** Anything with a voice can be addressed — a Person, or a test double. */
export type Speaker = { id: string; voice: NpcVoice };

/**
 * Register for someone whose disposition is known.
 *
 * A warm person opens up sooner than the bare trust number says; a cold one
 * keeps you at arm's length longer; someone badly rattled retreats into
 * formality. Reading the band through the persona is what makes personality
 * something the player HEARS rather than a number on a sheet.
 */
export function registerForPerson(
  who: Speaker & { trust: number; personality: Personality; mental: MentalState },
): RegisterInstruction {
  return registerFor(who, registerTrust(who.trust, who.personality, who.mental));
}

export function registerFor(who: Speaker, trust: number): RegisterInstruction {
  return {
    npc: who.id,
    selfPronoun: who.voice.selfPronoun,
    addressesPlayerAs: bandFor(trust, who.voice.addressBands) ?? '',
    particle: bandFor(trust, who.voice.particleBands) ?? '',
    tics: who.voice.tics,
    trust,
  };
}

/* -------------------------------------------------------------------------- */
/* The other direction: the player's own pronoun is an INPUT.                  */
/* -------------------------------------------------------------------------- */

export const TONES = ['crude', 'deferential', 'formal', 'polite', 'unknown'] as const;
export type Tone = (typeof TONES)[number];

/**
 * Markers are checked longest-first and masked once matched, so the formal long
 * form is not also counted as the plain polite one it contains.
 */
const MARKERS: { tone: Exclude<Tone, 'unknown'>; forms: string[] }[] = [
  { tone: 'formal', forms: ['เกล้ากระผม', 'กระหม่อม', 'กระผม', 'ท่าน', 'ขอรับ'] },
  { tone: 'deferential', forms: ['เจ้าค่ะ', 'ดิฉัน', 'หนู'] },
  { tone: 'crude', forms: ['โว้ย', 'มึง', 'กู', 'วะ'] },
  { tone: 'polite', forms: ['ครับ', 'ค่ะ', 'คะ', 'ผม', 'ฉัน', 'คุณ', 'เธอ'] },
];

/** Words that merely contain a pronoun's letters and must not trigger it. */
const FALSE_FRIENDS = ['กูเกิล', 'กูรู', 'ผมเผ้า', 'คุณภาพ', 'คุณสมบัติ', 'คุณค่า'];

const PRIORITY: Tone[] = ['crude', 'deferential', 'formal', 'polite', 'unknown'];

export type PlayerRegister = { detected: string[]; tone: Tone };

export function readPlayerRegister(text: string): PlayerRegister {
  let scratch = text;
  for (const ff of FALSE_FRIENDS) scratch = scratch.split(ff).join(' ');

  const detected: string[] = [];
  const tones = new Set<Tone>();

  const all = MARKERS.flatMap((m) => m.forms.map((f) => ({ tone: m.tone, form: f })));
  all.sort((a, b) => b.form.length - a.form.length);

  for (const { tone, form } of all) {
    if (!scratch.includes(form)) continue;
    detected.push(form);
    tones.add(tone);
    scratch = scratch.split(form).join(' ');
  }

  const tone = PRIORITY.find((t) => tones.has(t)) ?? 'unknown';
  return { detected, tone };
}

export type RegisterConsequence = { trust: number; suspicion: number; note: string | null };

/**
 * Addressing a superior with the crude form costs you; softening to the
 * self-diminutive buys you something. The language is the gameplay, so it has to
 * move the numbers.
 */
export function registerConsequence(tone: Tone, status: Status): RegisterConsequence {
  if (tone === 'crude') {
    if (status === 'superior') return { trust: -2, suspicion: 1, note: 'crude address to a superior' };
    return { trust: -1, suspicion: 0, note: 'crude address' };
  }
  if (tone === 'deferential' && status === 'superior') {
    return { trust: 1, suspicion: 0, note: 'deference to a superior' };
  }
  if (tone === 'formal' && status === 'superior') {
    return { trust: 1, suspicion: 0, note: 'proper formality to a superior' };
  }
  return { trust: 0, suspicion: 0, note: null };
}

/* -------------------------------------------------------------------------- */
/* Verifying that the writer actually complied                                 */
/* -------------------------------------------------------------------------- */

/** Does this text really use that pronoun, ignoring words that merely contain it? */
export function containsForm(text: string, form: string): boolean {
  if (!form.trim()) return false;
  let scratch = text;
  for (const ff of FALSE_FRIENDS) {
    if (ff.includes(form)) scratch = scratch.split(ff).join(' ');
  }
  return scratch.includes(form);
}

const THAI = /[฀-๿]/;
export const isThai = (text: string): boolean => THAI.test(text);

export type RegisterCheck = {
  ok: boolean;
  /** Fraction of the applicable constraints that were met, 0..1. */
  score: number;
  usedSelfPronoun: boolean;
  usedAddress: boolean;
  usedParticle: boolean;
  /** Forms that were explicitly banned but showed up anyway. */
  forbiddenFound: string[];
  isThai: boolean;
};

/**
 * Check generated prose against the register that was demanded.
 *
 * Register is the first constraint a model drops, and it is the one mechanic
 * this game is built around — so it is checked mechanically rather than hoped
 * for. Used both to benchmark candidate models and, at runtime, to decide
 * whether a passage needs regenerating.
 *
 * An empty required particle means "particles have dropped away at this
 * intimacy" — that constraint is simply not applicable rather than failed.
 */
export function checkRegister(
  text: string,
  want: { selfPronoun: string; addressesPlayerAs: string; particle: string },
  forbidden: string[] = [],
): RegisterCheck {
  const usedSelfPronoun = containsForm(text, want.selfPronoun);
  const usedAddress = containsForm(text, want.addressesPlayerAs);
  const particleRequired = want.particle.trim().length > 0 && want.particle.trim() !== '—';
  const usedParticle = particleRequired ? containsForm(text, want.particle.trim()) : true;

  const applicable = [
    want.selfPronoun.trim() ? usedSelfPronoun : null,
    want.addressesPlayerAs.trim() ? usedAddress : null,
    particleRequired ? usedParticle : null,
  ].filter((v): v is boolean => v !== null);

  // Mask the required forms out before hunting for banned ones, so a competing
  // form that is a SUBSTRING of a required one is not a false positive, and so
  // "used the right pronoun somewhere" cannot hide "also used three others".
  let residue = text;
  for (const required of [want.selfPronoun, want.addressesPlayerAs, want.particle]) {
    if (required.trim()) residue = residue.split(required).join(' ');
  }
  const forbiddenFound = forbidden.filter((f) => containsForm(residue, f));
  const thai = isThai(text);
  const met = applicable.filter(Boolean).length;

  return {
    ok: forbiddenFound.length === 0 && applicable.every(Boolean) && thai,
    score: applicable.length === 0 ? 1 : met / applicable.length,
    usedSelfPronoun,
    usedAddress,
    usedParticle,
    forbiddenFound,
    isThai: thai,
  };
}

/** The forms a Thai speaker picks between. Used to detect band mixing. */
const SELF_FORMS = ['ดิฉัน', 'กระผม', 'ผม', 'ฉัน', 'หนู', 'กู', 'ข้า'];
const ADDRESS_FORMS = ['คุณ', 'ท่าน', 'เธอ', 'มึง', 'เจ้า'];

/**
 * Forms from OTHER bands, which must not appear alongside the required ones.
 *
 * Checking only that the right pronoun is present lets a model hedge — one
 * character introducing herself with the polite female form and then switching
 * to the male one two lines later. Mixing bands IS register drift, so the
 * competing forms have to be banned explicitly.
 *
 * Particles are deliberately excluded: Thai stacks them naturally, and banning
 * them produces false alarms.
 */
export function competingForms(want: { selfPronoun: string; addressesPlayerAs: string }): string[] {
  return [
    ...SELF_FORMS.filter((f) => f !== want.selfPronoun),
    ...ADDRESS_FORMS.filter((f) => f !== want.addressesPlayerAs),
  ];
}
