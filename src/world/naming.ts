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
const isMachineId = (id: string): boolean => id.includes('_') || /\d/.test(id);

/**
 * People are held to a looser rule than places.
 *
 * A place id collides with ordinary English constantly — `town`, `gate`,
 * `market` — so only obviously machine-shaped ones are rewritten there. A
 * person id names one specific individual, and generated ones like
 * `guardcaptain` or `merchant1` read as machine tokens wherever they land. The
 * cost of missing one is a player reading "talk to guardcaptain"; the cost of
 * over-replacing is a proper name where a common noun belonged, which for
 * person ids barely happens.
 */
const isPersonId = (id: string): boolean => id.length >= 4;

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
    if (isPersonId(person.id) && person.name.trim()) names.set(person.id, person.name);
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

  return places.map((place) => ({
    ...place,
    name: humanise(place.name, names),
    description: humanise(place.description, names),
    affordances: tidyAffordances(place.affordances.map((a) => humanise(a, names))),
  }));
}

/* -------------------------------------------------------------------------- */
/* References to things that were never created                                */
/* -------------------------------------------------------------------------- */

/**
 * Tokens that look like an identifier rather than a word.
 *
 * The same shape `isMachineId` recognises, found loose inside prose. Anything
 * matching this in player-facing text is a reference the generator meant to be
 * resolved, so if it survives `humanise` it is pointing at something that does
 * not exist.
 */
const MACHINE_TOKEN = /\b[a-z][a-z']*(?:_[a-z0-9']+|[0-9]+)[a-z0-9_']*\b/gi;

/** Machine-shaped tokens left in a string once every known id was substituted. */
export const danglingTokens = (text: string): string[] => [...new Set(text.match(MACHINE_TOKEN) ?? [])];

export type Pruned = { places: Place[]; dropped: string[] };

/**
 * Remove affordances that point at somebody who was never created.
 *
 * Observed: a suggestion chip reading "listen to storyteller1" for a person the
 * model referenced but never defined. `humanise` cannot repair it — there is no
 * name to substitute — and an action naming a person who does not exist is
 * worse than one fewer suggestion, because the player will try it.
 *
 * The whole affordance goes rather than just the token: "listen to" is not an
 * action. Places are already required to keep at least one affordance by
 * `validateRegion`, which reports it if this strips a place bare.
 */
export function pruneDangling(places: readonly Place[], people: Record<string, Person>): Pruned {
  const known = displayNames(places, people);
  const dropped: string[] = [];

  const next = places.map((place) => {
    const kept = place.affordances.filter((affordance) => {
      const dangling = danglingTokens(affordance).filter((t) => !known.has(t.toLowerCase()));
      if (dangling.length === 0) return true;
      dropped.push(`${place.id}: "${affordance}"`);
      return false;
    });
    return kept.length === place.affordances.length ? place : { ...place, affordances: kept };
  });

  return { places: next, dropped };
}

/**
 * Unpick affordances the model joined into one string.
 *
 * Observed: a single chip reading `Observe Corvus repairing a boat", "Check
 * Beryl's herb garden`. The model emitted two actions as one array element,
 * leaving the JSON quoting it meant to produce embedded in the text. Smart
 * quotes are included because the schema-constrained decoder produces those as
 * often as straight ones.
 *
 * Splitting rather than discarding: both halves are perfectly good actions.
 */
export function tidyAffordances(affordances: readonly string[]): string[] {
  const out: string[] = [];

  for (const affordance of affordances) {
    for (const part of affordance.split(/["“”]\s*,\s*["“”]/)) {
      const trimmed = part.replace(/^["“”\s]+|["“”\s]+$/g, '').trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return [...new Set(out)];
}
