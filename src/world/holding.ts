import { STATUSES } from '../character/persona.ts';
import { PLAYER } from '../social/edge.ts';
import type { Person, PersonId, Place } from './types.ts';

/**
 * Who holds a place (DESIGN 6c *Ownership*, O1).
 *
 * Only a settlement is held. The PLAYER's holding is stored, on the place,
 * because it was bought and must not move; anybody else's is DERIVED from who
 * is there — the highest standing present, then the first listed — so a world
 * stored before ownership has holders too, and a holder who dies passes it on.
 * Null when nobody is there to hold it.
 */
export function holderOf(place: Place, people: Record<PersonId, Person>): PersonId | null {
  if (place.kind !== 'settlement') return null;
  if (place.holder) return place.holder;
  const here = place.people.filter((id) => people[id] && people[id].alive !== false);
  if (!here.length) return null;
  const rank = (id: PersonId) => STATUSES.indexOf(people[id].status);
  return [...here].sort((a, b) => rank(a) - rank(b))[0];
}

/** What a settlement costs on this floor: about ten won fights' coin (`rollCoin`). */
export const priceOf = (floor: number): number => 50 * Math.max(1, floor);

/** The trust a holder must have in you before they will sell. */
export const TRUST_TO_SELL = 2;

/** Whether the player holds this place. */
export const heldByPlayer = (place: Place): boolean => place.holder === PLAYER;
