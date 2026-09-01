import { actOnSheet } from '../../../../../src/server/game.ts';
import type { SheetAction } from '../../../../../src/play/sheetaction.ts';

export const dynamic = 'force-dynamic';

/** Panel actions: spending points, taking tree nodes, equipping, using. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { action?: SheetAction };
    if (!body.action) return Response.json({ error: 'no action given' }, { status: 400 });

    const result = await actOnSheet(id, body.action);
    return result ? Response.json(result) : Response.json({ error: 'no such session' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
