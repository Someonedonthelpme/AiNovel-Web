import type { Ability, Condition } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { ActiveEffect, ActiveKind, ActiveSkill } from './active.ts';

/**
 * Building a skill out of priced parts.
 *
 * The old generator picked one of four hardcoded effects, so two books found on
 * the same floor routinely taught the same thing. Authoring more entries would
 * only move the problem; what is needed is composition.
 *
 * TWO IDEAS CARRY THIS.
 *
 * The budget IS the balance. Every payload has a price, and a skill is bought
 * with a budget derived from where it came from — a shallow book is poor, a
 * deep one is rich. Nothing is hand-tuned per skill, which is the only way this
 * stays balanced once there are thousands of them. Same trick as the encounter
 * builder, and `scripts/skillgen.ts` measures whether the pricing holds.
 *
 * The grammar keeps it coherent. Balance is the easy half: random-but-fair
 * composition reliably produces "heal four and blind a foe six squares away",
 * which is legal, priced, and nonsense. So each discipline declares what it may
 * draw from — the Bow never heals, the Shield never bursts — and the result
 * still reads as belonging somewhere.
 *
 * USES ARE THE LEVER. Rather than adding a separate cost part, the budget buys
 * how OFTEN a skill can be used: a cheap payload comes with several uses, an
 * expensive one with a single use before a rest. That reuses the resource
 * economy already in place instead of inventing a second one.
 */

/* -------------------------------------------------------------------------- */
/* What a discipline is allowed to draw                                        */
/* -------------------------------------------------------------------------- */

export const PAYLOADS = ['strike', 'hinder', 'mend', 'rally', 'drain', 'burst', 'hex', 'edge'] as const;
export type PayloadKind = (typeof PAYLOADS)[number];

export type Grammar = {
  /** What this discipline may produce. */
  payloads: PayloadKind[];
  /** Conditions it is allowed to inflict, if it inflicts any. */
  conditions: Condition[];
  /** The furthest it reaches. Nought means it only ever touches you. */
  maxRange: number;
};

/* -------------------------------------------------------------------------- */
/* Prices                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a condition is worth per round.
 *
 * Taken from what each actually costs a combatant in `attackModifiers`: being
 * stunned hands every attacker advantage and takes the turn away, while prone
 * only helps whoever is standing next to you.
 */
const CONDITION_PRICE: Record<string, number> = {
  stunned: 4,
  restrained: 2.5,
  blinded: 2,
  poisoned: 1.5,
  grappled: 1.5,
  prone: 1,
};

const priceOf = (effect: ActiveEffect): number => {
  switch (effect.kind) {
    case 'strike':
      return effect.damage / 2;
    case 'hinder':
      return (CONDITION_PRICE[effect.condition] ?? 1) * effect.rounds;
    case 'mend':
      return effect.amount / 3;
    case 'rally':
      return 1.5;
    case 'drain':
      return effect.damage / 2 + effect.heal / 3;
    case 'burst':
      // Everything within the radius, so it scales with what it can catch.
      return (effect.damage / 2) * (1 + effect.radius * 0.8);
    case 'hex':
      return effect.damage / 2 + (CONDITION_PRICE[effect.condition] ?? 1) * effect.rounds;
    case 'edge':
      // Always on and never spent, so it is dear for what it looks like.
      return effect.bonus * 2.5;
  }
};

export const priceSkill = (skill: ActiveSkill): number =>
  priceOf(skill.effect) * Math.max(1, skill.usesPerRest || 1);

/** Reaching further is worth something, but far less than the payload. */
const rangePrice = (range: number): number => Math.max(0, range) * 0.25;

/* -------------------------------------------------------------------------- */
/* Drawing a payload to fit a budget                                           */
/* -------------------------------------------------------------------------- */

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/**
 * Which condition to reach for, given what there is to spend.
 *
 * A rich budget wants an expensive condition. Drawing evenly meant a floor
 * twenty book could roll `prone`, cap at three rounds, cap again at four uses,
 * and spend barely half of what it had — the measured low was 0.51, and it was
 * always the disciplines whose conditions are cheap.
 */
function conditionFor(rng: Rng, grammar: Grammar, budget: number): Condition {
  const ranked = [...grammar.conditions].sort(
    (a, b) => (CONDITION_PRICE[a] ?? 1) - (CONDITION_PRICE[b] ?? 1),
  );
  if (ranked.length === 1) return ranked[0];

  // Rich budgets draw from the dear half, poor ones from the cheap half.
  const rich = budget >= 10;
  const half = ranked.slice(rich ? Math.floor(ranked.length / 2) : 0, rich ? undefined : Math.ceil(ranked.length / 2));
  return pick(rng, half.length > 0 ? half : ranked);
}

/**
 * Draw one payload sized to roughly a third of the budget.
 *
 * A third rather than the whole of it, because the remainder is what buys
 * repeat uses — a skill worth its budget in a single use is a worse thing to
 * own than one you can use three times.
 */
function payloadFor(rng: Rng, kind: PayloadKind, grammar: Grammar, budget: number, ability: Ability): ActiveEffect {
  /*
   * Sized to about a third of the budget, WITH JITTER.
   *
   * A third rather than the whole of it, because the remainder buys repeat
   * uses — a skill worth its budget in one use is a worse thing to own than one
   * you can use three times.
   *
   * The jitter matters more than it looks. Without it the magnitude is a pure
   * function of the budget, so every strike found on floor nine did exactly
   * seven damage and only the KIND of payload varied — twelve books at a depth
   * produced six distinct skills between them, which is the duplication this
   * whole system exists to end. Spread costs nothing: the price moves with the
   * magnitude, and uses absorb the difference.
   */
  const target = Math.max(1, (budget / 3) * (0.75 + rng() * 0.6));

  switch (kind) {
    case 'strike':
      return { kind: 'strike', damage: Math.max(2, Math.round(target * 2)) };

    case 'hinder': {
      const condition = conditionFor(rng, grammar, budget);
      const price = CONDITION_PRICE[condition] ?? 1;
      return { kind: 'hinder', condition, rounds: Math.max(1, Math.min(3, Math.round(target / price))) };
    }

    case 'mend':
      return { kind: 'mend', amount: Math.max(3, Math.round(target * 3)) };

    case 'rally':
      return { kind: 'rally', condition: pick(rng, grammar.conditions) };

    case 'drain': {
      const damage = Math.max(2, Math.round(target * 1.2));
      return { kind: 'drain', damage, heal: Math.max(1, Math.round(damage / 2)) };
    }

    case 'burst': {
      const radius = 1 + Math.floor(rng() * 2);
      return { kind: 'burst', damage: Math.max(2, Math.round((target * 2) / (1 + radius * 0.8))), radius };
    }

    case 'hex': {
      const condition = conditionFor(rng, grammar, budget);
      return { kind: 'hex', damage: Math.max(2, Math.round(target)), condition, rounds: 1 + Math.floor(rng() * 2) };
    }

    case 'edge':
      return { kind: 'edge', ability, bonus: Math.max(1, Math.min(3, Math.round(target / 2.5))) };
  }
}

/** Which effects only ever touch the person using them. */
const REACHES = new Set<PayloadKind>(['strike', 'hinder', 'drain', 'burst', 'hex']);

export type ComposeInput = {
  id: string;
  name: string;
  description: string;
  kind: ActiveKind;
  ability: Ability;
  grammar: Grammar;
  /** What there is to spend. Deeper sources are richer. */
  budget: number;
};

/**
 * Compose one skill.
 *
 * Deterministic in the rng handed in, so a book found on floor nine teaches the
 * same thing on a replay as it did when it dropped.
 */
export function composeSkill(rng: Rng, input: ComposeInput): ActiveSkill {
  const { grammar, budget } = input;

  // Utility and social skills are the standing bonuses; combat draws widely.
  let allowed: PayloadKind[] = input.kind === 'combat'
    ? grammar.payloads.filter((p) => p !== 'edge')
    : grammar.payloads.filter((p) => p === 'edge');

  /*
   * `rally` is a flat price whatever it costs to buy, so a rich budget spent on
   * one is mostly wasted — it caps at four uses and stops. Dropped once there
   * is real money to spend, which is what lifted the measured floor from 0.51.
   */
  if (input.kind === 'combat' && budget >= 12 && allowed.length > 1) {
    allowed = allowed.filter((p) => p !== 'rally');
  }

  const kind = pick(rng, allowed.length > 0 ? allowed : grammar.payloads);
  const effect = payloadFor(rng, kind, grammar, budget, input.ability);

  const range = REACHES.has(kind) ? Math.max(1, Math.round(rng() * grammar.maxRange)) : 0;
  const unit = priceOf(effect) + rangePrice(range);

  /*
   * The budget buys repeats. An `edge` is always on and never spent, so it has
   * no uses at all — which is also why it is priced so much higher per point.
   */
  /*
   * FLOOR, not round.
   *
   * Rounding bought a third use out of two and a half, so a twenty-point
   * budget could walk away with twenty-four points of skill. Flooring can only
   * ever leave budget unspent, which is the safe direction to be wrong in — a
   * source that hands out more than it was given is how generation quietly
   * inflates.
   *
   * The floor of one is deliberate: a payload dearer than the whole budget is
   * still allowed, as a single formidable use.
   */
  const usesPerRest = kind === 'edge' ? 0 : Math.max(1, Math.min(4, Math.floor(budget / Math.max(1, unit))));

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    ability: input.ability,
    effect,
    range,
    usesPerRest,
  };
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Names composed from two banks rather than written.
 *
 * The grammar is authored even when the combination is not, which is what keeps
 * a generated name from reading as a serial number.
 */
const SHAPE = {
  en: {
    strike: ['Cut', 'Blow', 'Stroke', 'Thrust'],
    hinder: ['Snare', 'Bind', 'Hold', 'Check'],
    mend: ['Mending', 'Second Wind', 'Stitch', 'Recovery'],
    rally: ['Rally', 'Footing', 'Recovery', 'Stand'],
    drain: ['Draw', 'Tithe', 'Toll', 'Leeching'],
    burst: ['Flare', 'Wash', 'Spread', 'Bloom'],
    hex: ['Mark', 'Curse', 'Blight', 'Sign'],
    edge: ['Reading', 'Eye', 'Sense', 'Knack'],
  },
  th: {
    strike: ['รอยฟัน', 'หมัด', 'การแทง', 'ปาด'],
    hinder: ['บ่วง', 'พันธนาการ', 'การตรึง', 'การยับยั้ง'],
    mend: ['การสมาน', 'ลมที่สอง', 'การเย็บ', 'การฟื้น'],
    rally: ['การตั้งหลัก', 'ที่มั่น', 'การลุกขึ้น', 'การยืนหยัด'],
    drain: ['การดูด', 'ส่วย', 'ค่าผ่านทาง', 'การสูบ'],
    burst: ['การวาบ', 'คลื่น', 'การลาม', 'การบาน'],
    hex: ['รอยหมาย', 'คำสาป', 'ความเหี่ยว', 'เครื่องหมาย'],
    edge: ['การอ่าน', 'สายตา', 'สัมผัส', 'ความชำนาญ'],
  },
} as const;

const QUALIFIER = {
  en: ['Quiet', 'Long', 'Low', 'Sudden', 'Patient', 'Close', 'Bitter', 'Cold', 'Sure', 'Second'],
  th: ['เงียบ', 'ยาว', 'ต่ำ', 'ฉับพลัน', 'อดทน', 'ประชิด', 'ขม', 'เย็น', 'แม่นยำ', 'ที่สอง'],
} as const;

export function nameFor(rng: Rng, effect: ActiveEffect, language: 'th' | 'en'): string {
  const shape = pick(rng, SHAPE[language][effect.kind]);
  const qualifier = pick(rng, QUALIFIER[language]);
  return language === 'th' ? `${shape}${qualifier}` : `The ${qualifier} ${shape}`;
}

/** A stable generator from any string, so the same source composes the same skill. */
export function generatorFor(text: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}
