import { adopt, beliefAbout, claimKey, retell } from '../character/belief.ts';
import type { Belief } from '../character/belief.ts';

/**
 * What a PLACE knows.
 *
 * The scaling correction the design turned on: a rumour must not be simulated
 * person by person. A city market has no modelled people until somebody is
 * picked out of it, and giving every face a turn so that news could travel
 * would mean creating more NPCs than anyone can afford.
 *
 * MODEL THE MEDIUM, NOT THE MESSENGERS. Two layers, and they meet at both ends:
 *
 *   dramatic   people telling each other along the social graph, bounded by
 *              degrees of separation. WHO told WHOM matters, and lies and the
 *              correction arc live here. That is `deed.ts`.
 *   ambient    a PLACE knows a thing to a degree. No people involved at all.
 *              Anybody standing there who does not know it themselves inherits
 *              from it. That is this file.
 *
 * It is exactly the shape region LOD already has — two floors held in full
 * detail and the rest a gazetteer. AMBIENT KNOWLEDGE IS THE GAZETTEER OF
 * RUMOUR: cheap, lossy, and enough to be going on with.
 *
 * IT SPREADS ALONG THE MAP, which is what makes geography matter. The square
 * hears it first, the market the turn after, the gate at the edge of town maybe
 * never — so asking in the right place is worth something, and a road nobody
 * walks carries nothing.
 */

/** Per place, what is going around there. Beliefs, because a place can be wrong too. */
export type Ambient = Record<string, Belief[]>;

/**
 * How well known a thing has to be before somebody picks it up by standing
 * near it. Below this it is talk, not something you would repeat.
 */
export const AMBIENT_FLOOR = 0.3;

export const knownAt = (ambient: Ambient | undefined, place: string): Belief[] => ambient?.[place] ?? [];

/**
 * The air clearing.
 *
 * GOSSIP IS NOT MEMORY, and keeping the two apart is what stops a rude word
 * being known by the whole town at four-fifths certainty for the rest of the
 * game. What a person SAW stays on that person for good; what is merely going
 * around thins out and eventually stops being worth repeating.
 *
 * Without it the field converges and never moves again, and every NPC on the
 * floor carries every deed the player has ever done into every prompt.
 */
export function fadeAir(ambient: Ambient | undefined, fade: number): Ambient {
  if (!ambient || fade <= 0) return ambient ?? {};

  const out: Ambient = {};
  for (const [place, held] of Object.entries(ambient)) {
    const kept = held
      .map((b) => ({ ...b, confidence: b.confidence * (1 - fade) }))
      .filter((b) => b.confidence >= AMBIENT_FLOOR);
    if (kept.length) out[place] = kept;
  }
  return out;
}

/**
 * Put something into the air at one place.
 *
 * `adopt` decides: a stronger account displaces a weaker one and a weaker one is
 * ignored, so seeding the same thing twice cannot inflate it, and a place that
 * saw it firsthand is never talked down by a rumour arriving later.
 */
export function seed(ambient: Ambient | undefined, place: string, belief: Belief): Ambient {
  return { ...(ambient ?? {}), [place]: adopt(knownAt(ambient, place), belief) };
}

/**
 * One turn of news travelling.
 *
 * NEWS TRAVELS WITH PEOPLE, so a place carries nothing onward while nobody is
 * there — which is what makes a cut road or an emptied quarter FELT rather than
 * announced. Everything else is `retell`, the same distortion a person applies:
 * each place it passes through costs certainty, then the source, and far enough
 * out it can arrive meaning the opposite.
 *
 * `hops` is how far news gets in a turn; ZERO IS THE IDENTITY VALUE and means
 * nothing ever leaves the room it happened in.
 *
 * Converges rather than saturating: once every place holds the best account it
 * can reach, `adopt` refuses everything weaker and this stops changing.
 */
export function carry(
  ambient: Ambient | undefined,
  places: readonly { id: string; connections: string[]; people: string[] }[],
  hops: number,
  fade = 0,
): Ambient {
  let next = fadeAir(ambient, fade);
  const byId = new Map(places.map((p) => [p.id, p]));

  for (let hop = 0; hop < Math.max(0, hops); hop++) {
    let moved = false;
    // Sorted, because a fold that visited places in map order would depend on
    // insertion order and a replay could diverge.
    for (const from of [...places].sort((a, b) => a.id.localeCompare(b.id))) {
      if (from.people.length === 0) continue;

      for (const belief of [...knownAt(next, from.id)].sort((a, b) => claimKey(a.claim).localeCompare(claimKey(b.claim)))) {
        const told = retell(belief, from.id);
        if (told.confidence < AMBIENT_FLOOR) continue;

        for (const to of [...from.connections].sort()) {
          if (!byId.has(to)) continue;
          const held = beliefAbout(knownAt(next, to), told.claim);
          if (held && held.confidence >= told.confidence) continue;
          next = seed(next, to, told);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return next;
}

/**
 * What somebody standing here would have picked up.
 *
 * The join between the two layers, and the reason the ambient field exists: a
 * person who was not a witness and whom no chain of acquaintance reached STILL
 * knows what everyone around them knows. Walk into the market having done
 * something in the square, and the shopkeeper has heard.
 *
 * Their own belief always wins — `adopt` sees to that — because what you were
 * told to your face outranks what is in the air, and somebody who saw it should
 * not be talked down to hearsay by standing in a busy street.
 *
 * `ponytail: not yet filtered through the person. The design wants a stranger
 * to pick up only what their trade and standing would plausibly care about,
 * which needs interests that no generated NPC carries yet — `Person.tags` is
 * still written by both generators and read by nobody. Filter when individuation
 * lands and tags mean something.`
 */
export function inherited(held: readonly Belief[] | undefined, ambient: Ambient | undefined, place: string): Belief[] {
  let out = [...(held ?? [])];
  for (const belief of knownAt(ambient, place)) {
    if (belief.confidence < AMBIENT_FLOOR) continue;
    out = adopt(out, belief);
  }
  return out;
}
