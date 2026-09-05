import type { Ability, Condition } from '../combat/types.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { Rng } from '../engine/roll.ts';
import type { ActiveSkill } from './active.ts';
import { costs, flat, instant, magnitudeOf, purposes, self, single, usableInCombat } from './effect.ts';
import type { Channel, Effect } from './effect.ts';
import { MAX_COST, MIN_COST, poolFor } from './pools.ts';

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
  /*
   * `frightened` was missing from this table entirely, so every CHA hinder
   * fell through to the `?? 1` default and was priced as the cheapest thing in
   * the game — which is backwards, since taking somebody OUT of a fight is
   * worth more than knocking them over. It sits between blinded and poisoned:
   * it impairs their own attacks without exposing them to everyone else.
   */
  frightened: 1.75,
  poisoned: 1.5,
  grappled: 1.5,
  prone: 1,
};

/**
 * What a channel is worth per point.
 *
 * One table instead of the eight-arm switch this replaced, and adding a channel
 * no longer means editing a price list in two files that could disagree.
 */
const CHANNEL_WEIGHT: Record<Channel, number> = {
  hp: 0.5,
  stamina: 0.3,
  mana: 0.3,
  condition: 1,
  // Always on and never spent, so it is dear for what it looks like.
  stat: 2.5,
  special: 2,
};

/** Reaching more people is worth more than reaching further. */
const spread = (shape: Effect['shape']): number => {
  switch (shape.kind) {
    case 'burst': return 1 + shape.radius * 0.8;
    case 'cone':
    case 'line': return 1 + shape.length * 0.4;
    default: return 1;
  }
};

const held = (duration: Effect['duration']): number => {
  switch (duration.kind) {
    case 'rounds': return Math.max(1, duration.rounds);
    case 'sustained': return 3;
    default: return 1;
  }
};

/** Catching everybody is worth more than catching one of them. */
const reach = (who: Effect['who']): number => (who === 'everyone' ? 1.5 : 1);

export function priceEffect(effect: Effect): number {
  const per = effect.channel === 'condition'
    ? CONDITION_PRICE[effect.condition] ?? 1
    : CHANNEL_WEIGHT[effect.channel];
  return per * magnitudeOf(effect) * spread(effect.shape) * held(effect.duration) * reach(effect.who);
}

/**
 * What the whole thing is worth: what it does, less what it takes out of you.
 *
 * Costs SUBTRACT, which is what makes a severe cost a real design lever rather
 * than flavour — blood magic is cheap for what it does precisely because it is
 * paid for in something that hurts.
 */
export const priceOf = (effects: readonly Effect[]): number =>
  purposes(effects).reduce((total, e) => total + priceEffect(e), 0)
  - costs(effects).reduce((total, e) => total + priceEffect(e) * 0.5, 0);

export const priceSkill = (skill: ActiveSkill): number => priceOf(skill.effects);

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
 * Draw the PURPOSES for one payload kind, as components.
 *
 * The kinds survive as the GENERATOR'S vocabulary — "make me a strike" is a
 * good handle for a grammar to hold — but nothing stores one. What comes back
 * is components, which is why `drain` and `hex` return two effects each rather
 * than needing a fused union arm.
 */
function payloadFor(rng: Rng, kind: PayloadKind, grammar: Grammar, budget: number, ability: Ability): Effect[] {
  /*
   * SIZED TO WHAT IS LEFT, not to a third of it.
   *
   * A third was right while the remainder bought repeat uses. `usesPerRest` is
   * gone, so there is no second sink and a budget that only ever bought a third
   * of itself would make every deep book a shallow one. What absorbs the
   * remainder now is ANOTHER EFFECT — see `composeSkill`.
   *
   * The jitter matters more than it looks. Without it the magnitude is a pure
   * function of the budget, so every strike found on floor nine did exactly
   * seven damage and only the KIND of payload varied — twelve books at a depth
   * produced six distinct skills between them, which is the duplication this
   * whole system exists to end.
   *
   * Each arm below turns `target` into roughly `target` worth of price, so the
   * budget arithmetic in `composeSkill` can be done in one currency.
   */
  const target = Math.max(1, budget * (0.55 + rng() * 0.4));

  const hurt = (amount: number, shape: Effect['shape'] = single): Effect => ({
    role: 'purpose', sign: 'minus', channel: 'hp', who: 'foe', shape, duration: instant, formula: flat(amount),
  });

  switch (kind) {
    case 'strike':
      return [hurt(Math.max(2, Math.round(target * 2)))];  // 0.5 per point

    case 'hinder': {
      const condition = conditionFor(rng, grammar, budget);
      const price = CONDITION_PRICE[condition] ?? 1;
      return [{
        role: 'purpose', sign: 'minus', channel: 'condition', condition, who: 'foe', shape: single,
        duration: { kind: 'rounds', rounds: Math.max(1, Math.min(3, Math.round(target / price))) },
        formula: flat(1),
      }];
    }

    case 'mend':
      return [{
        role: 'purpose', sign: 'plus', channel: 'hp', who: 'own', shape: self, duration: instant,
        formula: flat(Math.max(3, Math.round(target * 2))),
      }];

    case 'rally':
      return [{
        role: 'purpose', sign: 'plus', channel: 'condition', condition: pick(rng, grammar.conditions),
        who: 'own', shape: self, duration: instant, formula: flat(1),
      }];

    case 'drain': {
      // Two effects, which is what it always was.
      // 0.5 on the damage plus 0.5 on half of it back = 0.75 per point.
      const damage = Math.max(2, Math.round(target * 1.33));
      return [
        hurt(damage),
        {
          role: 'purpose', sign: 'plus', channel: 'hp', who: 'own', shape: self, duration: instant,
          formula: flat(Math.max(1, Math.round(damage / 2))),
        },
      ];
    }

    case 'burst': {
      const radius = 1 + Math.floor(rng() * 2);
      return [hurt(
        Math.max(2, Math.round((target * 2) / (1 + radius * 0.8))),
        { kind: 'burst', radius },
      )];
    }

    case 'hex': {
      // And so was this one.
      const condition = conditionFor(rng, grammar, budget);
      return [
        hurt(Math.max(2, Math.round(target))),
        {
          role: 'purpose', sign: 'minus', channel: 'condition', condition, who: 'foe', shape: single,
          duration: { kind: 'rounds', rounds: 1 + Math.floor(rng() * 2) }, formula: flat(1),
        },
      ];
    }

    case 'edge':
      return [{
        role: 'purpose', sign: 'plus', channel: 'stat', stat: ability, who: 'own', shape: self,
        duration: { kind: 'sustained' },
        formula: flat(Math.max(1, Math.min(3, Math.round(target / 2.5)))),
      }];
  }
}

/** Which effects only ever touch the person using them. */
const REACHES = new Set<PayloadKind>(['strike', 'hinder', 'drain', 'burst', 'hex']);

/* -------------------------------------------------------------------------- */
/* The allow-list, per axis                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Which channels each generator kind can put on the board.
 *
 * The bridge from the grammar — which still speaks in kinds, because "make me a
 * strike" is a good handle for one to hold — to the COMPONENTS, which are what
 * actually gets stored. It is what lets a grammar be checked against a finished
 * skill rather than against a kind the composer has already thrown away.
 */
const KIND_CHANNELS: Record<PayloadKind, Channel[]> = {
  strike: ['hp'],
  burst: ['hp'],
  mend: ['hp'],
  drain: ['hp'],
  hinder: ['condition'],
  rally: ['condition'],
  hex: ['hp', 'condition'],
  edge: ['stat'],
};

/** The channels a stat is allowed to touch at all. */
export const channelsOf = (grammar: Grammar): Set<Channel> =>
  new Set(grammar.payloads.flatMap((p) => KIND_CHANNELS[p]));

/**
 * Whether a finished skill is one this grammar could have produced.
 *
 * Three checks, and all of them are on the components: the channel is one the
 * stat may touch, any condition is one it may inflict, and it does not reach
 * further than the stat reaches. Costs are exempt — what a skill takes out of
 * YOU is not something the grammar has an opinion about.
 */
export function obeys(skill: ActiveSkill, grammar: Grammar): string | null {
  const channels = channelsOf(grammar);
  for (const e of purposes(skill.effects)) {
    if (!channels.has(e.channel)) return `touches ${e.channel}`;
    if (e.channel === 'condition' && !grammar.conditions.includes(e.condition)) {
      return `inflicts ${e.condition}`;
    }
  }
  return skill.range > grammar.maxRange ? `reaches ${skill.range}` : null;
}

export type ComposeInput = {
  id: string;
  name: string;
  description: string;
  ability: Ability;
  grammar: Grammar;
  /** What there is to spend. Deeper sources are richer. */
  budget: number;
  /** Which words to name it with, when `name` is blank. */
  language?: 'th' | 'en';
};

/**
 * Compose one skill.
 *
 * Deterministic in the rng handed in, so a book found on floor nine teaches the
 * same thing on a replay as it did when it dropped.
 */
export function composeSkill(rng: Rng, input: ComposeInput): ActiveSkill {
  const { grammar, budget } = input;

  /*
   * A STANDING BONUS IS A DIFFERENT KIND OF THING, and that is now the only
   * split — `ActiveKind` is gone, because a skill is used as you please.
   *
   * Something held is drawn only when the budget is too thin to buy an action
   * worth having: a permanent +1 is a fine consolation and a poor headline.
   */
  const thin = budget < 6;
  let allowed: PayloadKind[] = thin
    ? grammar.payloads.filter((p) => p === 'edge')
    : grammar.payloads.filter((p) => p !== 'edge');
  if (allowed.length === 0) allowed = [...grammar.payloads];

  /*
   * `rally` is flat-priced however much is spent on it, so a rich budget goes
   * mostly to waste on one. Dropped once there is real money about.
   */
  if (budget >= 12 && allowed.length > 1) allowed = allowed.filter((p) => p !== 'rally');

  /*
   * DRAW UNTIL THE BUDGET IS SPENT, rather than once.
   *
   * The remainder used to buy repeat uses; with `usesPerRest` gone it buys
   * another EFFECT. That is what stops a deep book being priced like a shallow
   * one when its payload caps out — a condition holds for three rounds at most,
   * so a rich hinder becomes a hinder AND a blow rather than a longer hold.
   *
   * It is also the shape the component model was argued for: `drain` and `hex`
   * were compound all along, and now anything can be.
   */
  const from = allowed.length > 0 ? allowed : grammar.payloads;
  const kinds: PayloadKind[] = [];
  const purpose: Effect[] = [];
  let left = budget;

  for (let part = 0; part < 3; part++) {
    const kind = pick(rng, from);
    let drawn = payloadFor(rng, kind, grammar, left, input.ability);
    let price = priceOf(drawn);

    /*
     * A PART THAT BUSTS WHAT IS LEFT IS REDRAWN AGAINST A BUDGET SCALED TO FIT.
     *
     * Not every arm turns `target` into `target` worth of price — `hex` puts a
     * condition on top of a blow and can come in half again over. Scaling the
     * budget by how far it overshot and drawing once more converges without
     * needing each arm to be exactly calibrated.
     */
    if (price > left && price > 0) {
      drawn = payloadFor(rng, kind, grammar, (left * left) / price, input.ability);
      price = priceOf(drawn);
    }

    // A later part may not take the whole thing over what it was given.
    if (part > 0 && price > left) break;
    purpose.push(...drawn);
    kinds.push(kind);
    left -= price;
    if (left < budget * 0.25) break;
  }

  const reaches = kinds.some((k) => REACHES.has(k));
  const range = reaches ? Math.max(1, Math.round(rng() * grammar.maxRange)) : 0;

  /*
   * THE COST IS AN EFFECT, drawn from what the purpose is worth.
   *
   * It used to be implied — a number derived from the payload every time
   * anybody asked. Declaring it means a skill can cost something other than a
   * pool, which is the whole reason blood magic needs no special case.
   *
   * A sustained bonus is never spent, so it carries no cost at all; that is
   * why it is priced so much higher per point.
   */
  /*
   * A STANDING BONUS IS THE ONE THING THAT IS FREE, because it is held rather
   * than thrown — charging for it would mean charging every round for ever.
   *
   * Keyed on what the skill DOES, not on whether the budget was thin. Keying it
   * on `thin` meant a shallow STR book, whose grammar has no standing bonus to
   * fall back on, composed a real blow and then cost nothing at all.
   */
  const worth = priceOf(purpose) + rangePrice(range);
  const effects: Effect[] = usableInCombat(purpose)
    ? [...purpose, costFor(input.ability, worth)]
    : purpose;

  /*
   * NAMED HERE, because only here is the payload kind known.
   *
   * Every caller used to compose and then name in a second step, which meant
   * each of them had to be handed a kind that `composeSkill` had already
   * chosen and thrown away — `classbuild` passed a hardcoded `'strike'` for
   * want of anything better.
   */
  return {
    id: input.id,
    name: input.name || nameFor(rng, kinds[0], input.language ?? 'en'),
    description: input.description,
    ability: input.ability,
    effects,
    range,
  };
}

/**
 * What throwing it takes out of you.
 *
 * Which pool follows the STAT, not the payload — a strike on STR is exertion
 * and a strike on INT is concentration. Floored and capped so nothing is free
 * and nothing found deep is unusable at the level it is found.
 */
function costFor(ability: Ability, worth: number): Effect {
  return {
    role: 'cost',
    sign: 'minus',
    channel: poolFor(ability),
    who: 'own',
    shape: self,
    duration: instant,
    formula: flat(Math.max(MIN_COST, Math.min(MAX_COST, Math.round(worth / 2)))),
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

export function nameFor(rng: Rng, kind: PayloadKind, language: 'th' | 'en'): string {
  const shape = pick(rng, SHAPE[language][kind]);
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
