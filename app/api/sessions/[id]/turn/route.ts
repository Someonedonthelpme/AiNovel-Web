import { takeTurn } from '../../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const input = String(body.input ?? '').trim();
  if (!input) return Response.json({ error: 'say something' }, { status: 400 });

  const mode = body.mode === 'exploration' ? 'exploration' : 'conversation';
  try {
    const result = await takeTurn(id, input, mode);
    return result ? Response.json(result) : Response.json({ error: 'no such session' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
