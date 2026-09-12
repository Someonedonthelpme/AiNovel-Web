/**
 * The social and exploration resolver: 2d6 + modifier, three tiers.
 *
 * Combat uses d20 (see `src/combat/dice.ts`) because a fight is binary — you hit
 * or you do not. Conversation is not: binary pass/fail makes dialogue flat,
 * whereas "success at a cost" is what generates story. On 2d6 that middle
 * outcome is also the MODAL one, so failing forward is the default rather than
 * something the narration has to remember to do.
 *
 * Deliberately self-contained: the RNG type here is shared with the combat dice.
 */

export const TIERS = ['miss', 'partial', 'hit'] as const;
export type Tier = (typeof TIERS)[number];

export function tierFor(total: number): Tier {
  if (total <= 6) return 'miss';
  if (total <= 9) return 'partial';
  return 'hit';
}

export type Rng = () => number;

/** Deterministic RNG so a seeded session replays identically. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const d6 = (rng: Rng): number => Math.floor(rng() * 6) + 1;

export type SocialRoll = {
  /** Which ability was leaned on, for narration. */
  ability: string;
  /** Who resisted, if anyone. */
  vs: { id: string; ability: string } | null;
  dice: [number, number];
  modifier: number;
  total: number;
  tier: Tier;
};

/**
 * Resolution happens HERE, in code — never in the model. The Writer is handed
 * the tier as a fact it must narrate, which is the only reason failure is
 * possible at all.
 */
export function roll(
  rng: Rng,
  opts: {
    ability: string;
    modifier: number;
    vs?: { id: string; ability: string; modifier: number } | null;
  },
): SocialRoll {
  const dice: [number, number] = [d6(rng), d6(rng)];
  const opposing = opts.vs ? opts.vs.modifier : 0;
  const modifier = opts.modifier - opposing;
  const total = dice[0] + dice[1] + modifier;
  return {
    ability: opts.ability,
    vs: opts.vs ? { id: opts.vs.id, ability: opts.vs.ability } : null,
    dice,
    modifier,
    total,
    tier: tierFor(total),
  };
}

/**
 * A seed out of words.
 *
 * Seven files grew their own private copy of this before it was worth
 * exporting; the new ones use this. Same FNV-shaped mix they all used, so a
 * caller that switches over keeps the numbers it had.
 */
export function hashText(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0);
  return h >>> 0;
}
