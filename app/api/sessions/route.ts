import { listSessions } from '../../../src/db/sessions.ts';
import { bootstrap } from '../../../src/db/db.ts';
import { newGame } from '../../../src/server/game.ts';

export const dynamic = 'force-dynamic';
// Session Zero is a full generation pass; it needs room to finish.
export const maxDuration = 300;

export async function GET() {
  await bootstrap();
  return Response.json(await listSessions(30));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const language = body.language === 'th' ? 'th' : 'en';
  try {
        // The seed the creation page generated its class roster from. Without it
    // the player would be handed a world whose classes are not the ones they
    // were shown.
    const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : undefined;
    return Response.json({ id: await newGame(language, body.answers, body.draft, seed, body.rules, body.structure, body.species, body.loop, body.era) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
