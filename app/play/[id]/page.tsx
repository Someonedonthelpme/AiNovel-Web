import { getGame } from '../../../src/server/game.ts';
import Game from './Game.tsx';

export const dynamic = 'force-dynamic';

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getGame(id);

  if (!view) {
    return (
      <main className="shell">
        <p>No such session. <a href="/">Back to the list.</a></p>
      </main>
    );
  }
  return <Game initial={view} />;
}
