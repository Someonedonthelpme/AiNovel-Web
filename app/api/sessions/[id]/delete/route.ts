import { bootstrap } from '../../../../../src/db/db.ts';
import { deleteSession } from '../../../../../src/db/sessions.ts';

export const dynamic = 'force-dynamic';

/**
 * Delete a run, and everything it wrote.
 *
 * A POST rather than a DELETE verb so it goes through the same plumbing as
 * every other action here; the cascades on events, snapshots and facts take
 * care of the rest.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await bootstrap();
    await deleteSession(id);
    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
