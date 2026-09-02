import { classShapesFor } from '../../../src/character/classgen.ts';
import { buildClass } from '../../../src/character/classbuild.ts';
import { nameClasses } from '../../../src/character/classnames.ts';
import { provider } from '../../../src/server/game.ts';

/**
 * This world's classes.
 *
 * Called from the creation page once the player has said what kind of world
 * the tower stands in, because that answer is the whole input: the code
 * decides the shapes and the model says what they are CALLED there.
 *
 * The naming call is allowed to fail. `nameClasses` swallows its own errors
 * and `buildClass` falls back to role words, so a roster always comes back —
 * a creation page that will not render because the model was down would be a
 * far worse failure than "The Standing" instead of "Harbour Guard".
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const seed = Number(body.seed);
  if (!Number.isFinite(seed)) {
    return Response.json({ error: 'a seed is required' }, { status: 400 });
  }

  const language = body.language === 'th' ? 'th' : 'en';
  const shapes = classShapesFor(seed);
  const naming = await nameClasses(provider(), shapes, String(body.world ?? ''), language);

  return Response.json({
    classes: shapes.map((shape) =>
      buildClass(shape, naming.find((n) => n.shapeId === shape.id) ?? null, language)),
  });
}
