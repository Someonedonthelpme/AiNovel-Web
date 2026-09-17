import { PROFESSIONS } from '../character/population.ts';
import { dispositionOf } from '../character/persona.ts';
import { axisOf, PLAYER } from '../social/edge.ts';
import { endOfRef, idOfRef, owedBy, permittedBy, roleById, rolesOf } from '../social/roles.ts';
import type { Person, PersonId, World } from '../world/types.ts';

/**
 * What somebody IS in their world, for what a grudge of theirs can do
 * (DESIGN 6b stage 7.1d).
 *
 * DERIVED, never stored, from their roles, their trade and their status, so a
 * world needs nothing generated and nothing migrated. Closed, like every
 * vocabulary the engine resolves; free-text `tags` are never read, because a
 * closed list cannot rest on words a model invented.
 */
export const STATIONS = ['noble', 'merchant', 'guard', 'adventurer', 'villager', 'beggar'] as const;
export type Station = (typeof STATIONS)[number];

/** Somebody's trade, when they have one: a crowd-built sheet carries it as its background. */
const tradeOf = (person: Person | undefined): string | null => {
  const id = person?.sheet?.background.id;
  return id && (PROFESSIONS as readonly string[]).includes(id) ? id : null;
};

/** Everyone `who` holds any edge with. */
const tiesOf = (world: World, who: PersonId): PersonId[] =>
  [...new Set(Object.values(world.edges ?? {}).flatMap((e) => (e.from === who ? [e.to] : e.to === who ? [e.from] : [])))]
    .filter((id) => id !== PLAYER)
    .sort();

/** People `who` may command, living and not already on the road. */
export function commandedBy(world: World, who: PersonId): PersonId[] {
  const roles = rolesOf(world);
  const away = new Set((world.journeys ?? []).map((j) => j.who));
  return tiesOf(world, who).filter(
    (id) => world.people[id]?.alive && !away.has(id) && permittedBy(world.edges, roles, who, id).includes('command'),
  );
}

/** People who owe `who`: coin by a role, or a real obligation. Living and not on the road. */
export function debtorsOf(world: World, who: PersonId): PersonId[] {
  const roles = rolesOf(world);
  const away = new Set((world.journeys ?? []).map((j) => j.who));
  return tiesOf(world, who).filter(
    (id) => world.people[id]?.alive && !away.has(id)
      && (owedBy(world.edges, roles, id, who).includes('coin') || axisOf(world.edges, id, who, 'obligation') >= 2),
  );
}

/**
 * The mapping the user approved, in order:
 *   noble      may command someone, and is superior or holds a landmark
 *   merchant   a creditor: the lender's end of an exchange role. "Owed coin"
 *              would also catch a servant, whom a master owes wages
 *   guard      a watcher or a brute by trade
 *   adventurer a hunter or a raider by trade
 *   beggar     inferior, and bound to nobody by any role
 *   villager   everyone else
 */
export function stationOf(world: World, who: PersonId): Station {
  const person = world.people[who];
  const roles = rolesOf(world);
  const ties = tiesOf(world, who);
  const holdsLandmark = Object.values(world.regions).some((r) => 'boss' in r && r.boss === who);

  if (ties.some((id) => permittedBy(world.edges, roles, who, id).includes('command'))
    && (person?.status === 'superior' || holdsLandmark)) return 'noble';
  const lends = (id: PersonId) => (world.edges?.[`${who}>${id}`]?.roles ?? [])
    .some((ref) => roleById(roles, idOfRef(ref))?.kind === 'exchange' && endOfRef(ref) === 'a');
  if (ties.some(lends)) return 'merchant';

  const trade = tradeOf(person);
  if (trade === 'watcher' || trade === 'brute') return 'guard';
  if (trade === 'hunter' || trade === 'raider') return 'adventurer';

  const bound = ties.some((id) => (world.edges?.[`${who}>${id}`]?.roles ?? []).length > 0);
  if (person?.status === 'inferior' && !bound) return 'beggar';
  return 'villager';
}

/**
 * The acts a station opens BEYOND coming themselves, which is open to everyone —
 * it is what every grudge did before 7.1d. Slander, bans and bounties join this
 * list in later stages.
 */
const OPENS: Record<Station, readonly ('send' | 'debt')[]> = {
  noble: ['send', 'debt'],
  merchant: ['debt'],
  guard: [],
  adventurer: [],
  villager: ['debt'],
  beggar: [],
};

/**
 * Who a grudge sends: the bearer themselves if they are bold enough, else
 * somebody they command, else somebody who owes them, else themselves anyway.
 * Nerve is `dispositionOf`, which an unmet safety need already pulls down, so a
 * frightened bearer counts as timid without a second rule.
 */
export function whoGoes(world: World, bearer: PersonId): PersonId {
  const person = world.people[bearer];
  if (!person) return bearer;
  if (dispositionOf(person).nerve >= 1) return bearer;

  const opens = OPENS[stationOf(world, bearer)];
  if (opens.includes('send')) {
    const [sent] = commandedBy(world, bearer);
    if (sent) return sent;
  }
  if (opens.includes('debt')) {
    const [called] = debtorsOf(world, bearer);
    if (called) return called;
  }
  return bearer;
}
