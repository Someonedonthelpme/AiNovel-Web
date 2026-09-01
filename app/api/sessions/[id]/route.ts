import { getGame } from '../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getGame(id);
  return view ? Response.json(view) : Response.json({ error: 'no such session' }, { status: 404 });
}
