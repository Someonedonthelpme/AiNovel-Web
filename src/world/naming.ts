import type { Person, Place } from './types.ts';

/**
 * Keeping machine identifiers out of prose.
 *
 * Generated places carry an `id` and a `name`, and the model is asked for both
 * in the same object. It routinely reaches for the id when writing the parts a
 * player reads — producing affordances like "climb stair_tower" and prose like
 * "the vast emptiness of warehouse_south", because the Writer is shown those
 * affordances and echoes them faithfully.
 *
 * Deterministic repair rather than a sterner prompt: the mapping from id to
 * name is known exactly, so this is arithmetic, not persuasion. Same reason
 * `repairVoiceForm` exists.
 */

/**
 * Ids that could never be an English or Thai word.
 *
 * Only identifiers containing an underscore are rewritten. Plain single-word
 * ids like `town` or `gate` are indistinguishable from ordinary prose, and
 * substituting those would turn "walk into the town" into "walk into the
 * Ashfall" — a worse bug than the one being fixed.
 */
const isMachineId = (id: string): boolean => id.includes('_');

/**
 * Case-insensitive literal replacement.
 *
 * Deliberately not a regex: ids contain apostrophes and underscores, and
 * escaping them correctly is a bug waiting to happen for no benefit.
 */
function replaceAll(text: string, needle: string, replacement: string): string {
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  let out = '';
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(target, from);
    if (at === -1) return out + text.slice(from);
    out += text.slice(from, at) + replacement;
    from = at + target.length;
  }
}

/** Build the substitution once; a region's places and people are both keyed by id. */
export function displayNames(places: readonly Place[], people: Record<string, Person>): Map<string, string> {
  const names = new Map<string, string>();
  for (const place of places) if (isMachineId(place.id) && place.name.trim()) names.set(place.id, place.name);
  for (const person of Object.values(people)) {
    if (isMachineId(person.id) && person.name.trim()) names.set(person.id, person.name);
  }
  return names;
}

/**
 * Replace every machine id in a player-facing string with its display name.
 *
 * Longest first, so an id that contains another one cannot be half-rewritten.
 */
export function humanise(text: string, names: Map<string, string>): string {
  if (!text) return text;
  let out = text;
  for (const id of [...names.keys()].sort((a, b) => b.length - a.length)) {
    out = replaceAll(out, id, names.get(id)!);
  }
  return out;
}

/** Every string on a place that a player can end up reading. */
export function humanisePlaces(places: readonly Place[], people: Record<string, Person>): Place[] {
  const names = displayNames(places, people);
  if (names.size === 0) return [...places];

  return places.map((place) => ({
    ...place,
    name: humanise(place.name, names),
    description: humanise(place.description, names),
    affordances: place.affordances.map((a) => humanise(a, names)),
  }));
}
