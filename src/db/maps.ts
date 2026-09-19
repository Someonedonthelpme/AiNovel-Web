import { and, eq } from 'drizzle-orm';
import { getDb } from './db.ts';
import { maps } from './schema.ts';
import type { GameMap, MapId } from '../world/map.ts';

/**
 * A session's map: the stored one, or — on first entry — `draw()`, stored.
 *
 * Once stored it is never redrawn, so a change to the generator never moves a map
 * a session has seen (DESIGN 6c §2). Two callers racing on first entry both get
 * whichever was stored first.
 */
export async function mapFor(sessionId: string, mapId: MapId, draw: () => GameMap): Promise<GameMap> {
  const db = getDb();
  const stored = () => db.select({ map: maps.map }).from(maps)
    .where(and(eq(maps.sessionId, sessionId), eq(maps.mapId, mapId)));
  const found = await stored();
  if (found[0]) return found[0].map;
  await db.insert(maps).values({ sessionId, mapId, map: draw() }).onConflictDoNothing();
  return (await stored())[0].map;
}
