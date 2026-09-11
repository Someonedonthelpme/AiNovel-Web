import { climbFloor, climbTarget } from '../../../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // A way out that is not the stair, when the body names one.
    const target = climbTarget(await request.text());
    if (target.error) return Response.json({ error: target.error }, { status: 400 });
    const result = await climbFloor(id, target.to);
    return result ? Response.json(result) : Response.json({ error: 'no such session' }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
