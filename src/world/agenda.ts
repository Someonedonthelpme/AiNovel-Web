import type { Person } from './types.ts';

/**
 * People pursue their goals whether or not the player is watching.
 *
 * Progress is a pure function of elapsed turns rather than accumulated state,
 * which makes it trivially deterministic under replay and impossible to
 * double-advance. It is also the cheapest thing that makes a world feel alive
 * instead of a row of vending machines: no model call, no stored counter.
 */

export type Agent = Pick<Person, 'id' | 'agenda' | 'agendaPace'>;

export function agendaStepFor(person: Agent, turnsElapsed: number): number {
  const agenda = person.agenda ?? [];
  if (agenda.length === 0) return 0;
  const pace = Math.max(1, person.agendaPace ?? 3);
  return Math.min(Math.floor(Math.max(0, turnsElapsed) / pace), agenda.length);
}

export type AgendaProgress = { person: string; done: string[]; next: string | null };

/** What each person has done off-screen so far. Feeds the Director's context. */
export function agendaProgress(people: Agent[], turnsElapsed: number): AgendaProgress[] {
  return people
    .filter((p) => (p.agenda ?? []).length > 0)
    .map((p) => {
      const agenda = p.agenda ?? [];
      const step = agendaStepFor(p, turnsElapsed);
      return { person: p.id, done: agenda.slice(0, step), next: agenda[step] ?? null };
    });
}
