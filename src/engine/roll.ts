import type { Bible, NpcId, RollResult, StatName, Tier } from './types.ts';

/**
 * 2d6 + stat - opposing stat, three tiers.
 *
 * The bell curve is the point: partial success is the modal outcome, which makes
 * fail-forward the default rather than something the narration has to remember.
 */
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

/**
 * Resolution happens HERE, in code — never in the model. The Writer is handed the
 * tier as a fact it must narrate, which is the only reason failure is possible.
 */
export function roll(
  rng: Rng,
  opts: {
    stat: StatName;
    statValue: number;
    vs?: { npc: NpcId; stat: StatName; value: number } | null;
  },
): RollResult {
  const dice: [number, number] = [d6(rng), d6(rng)];
  const opposing = opts.vs ? opts.vs.value : 0;
  const modifier = opts.statValue - opposing;
  const total = dice[0] + dice[1] + modifier;
  return {
    stat: opts.stat,
    vs: opts.vs ? { npc: opts.vs.npc, stat: opts.vs.stat } : null,
    dice,
    modifier,
    total,
    tier: tierFor(total),
  };
}

/** Look up both sides of an opposed check from the frozen bible. */
export function opposedFrom(
  bible: Bible,
  stat: StatName,
  vs: { npc: NpcId; stat: StatName } | null,
): { statValue: number; vs: { npc: NpcId; stat: StatName; value: number } | null } {
  const statValue = bible.pc.stats[stat] ?? 0;
  if (!vs) return { statValue, vs: null };
  const npc = bible.cast.find((n) => n.id === vs.npc);
  if (!npc) return { statValue, vs: null };
  return { statValue, vs: { npc: vs.npc, stat: vs.stat, value: npc.stats[vs.stat] ?? 0 } };
}
