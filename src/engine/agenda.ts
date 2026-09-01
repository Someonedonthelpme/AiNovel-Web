import type { Bible, Npc } from './types.ts';

/**
 * NPCs pursue their goals whether or not the player is watching.
 *
 * Progress is a pure function of total clock spent rather than accumulated state,
 * which makes it trivially deterministic under replay and impossible to
 * double-advance.
 */
export function agendaStepFor(npc: Npc, clockSpent: number): number {
  const pace = Math.max(1, npc.agendaPace);
  return Math.min(Math.floor(clockSpent / pace), npc.agenda.length);
}

/** What each NPC has done so far, off-screen. Feeds the Director's context. */
export function agendaProgress(
  bible: Bible,
  clockSpent: number,
): { npc: string; done: string[]; next: string | null }[] {
  return bible.cast.map((npc) => {
    const step = agendaStepFor(npc, clockSpent);
    return {
      npc: npc.id,
      done: npc.agenda.slice(0, step),
      next: npc.agenda[step] ?? null,
    };
  });
}
