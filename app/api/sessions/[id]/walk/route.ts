import { walkOnMap, walkTarget } from '../../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // A tile on the map you stand on; checked here, and refused rather than guessed at.
    const { target, error } = walkTarget(await request.text());
    if (!target) return Response.json({ error }, { status: 400 });
    const result = await walkOnMap(id, target);
    return result ? Response.json(result) : Response.json({ error: 'no such session' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
