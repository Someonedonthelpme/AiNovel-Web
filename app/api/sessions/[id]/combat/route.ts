import { actInCombat } from '../../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!body.action) return Response.json({ error: 'no action' }, { status: 400 });

  try {
    const result = await actInCombat(id, body.action);
    return result
      ? Response.json(result)
      : Response.json({ error: 'no fight is happening' }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
