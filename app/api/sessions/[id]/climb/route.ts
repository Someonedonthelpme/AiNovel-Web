import { climbFloor } from '../../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await climbFloor(id);
    return result ? Response.json(result) : Response.json({ error: 'no such session' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
