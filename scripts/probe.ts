/**
 * A scripted play-through of the REAL server path, for verifying what unit tests
 * with a fake model cannot: whether a live model and the live fold actually
 * produce the loop band, the era band and buying a settlement.
 *
 *   node --experimental-strip-types scripts/probe.ts                  to floor 22
 *   node --experimental-strip-types scripts/probe.ts --to 3 --seed 7  a short run
 *   node --experimental-strip-types scripts/probe.ts --no-buy         climb only: the bands, no fights
 *
 * It calls the same functions the web routes call (`src/server/game.ts`), so a
 * fight, a climb and a purchase go through the fold and the log exactly as a
 * player's would. It needs LM Studio and Postgres, and makes one model call per
 * turn and per floor built: a full run is the better part of an hour. Pin it to
 * the efficiency cores (memory `dev-machine-pcore-fault`).
 *
 * It never fails a check; it LOGS what happened, for a person to read. Lines
 * starting `FINDING` are the ones worth reading first.
 */
import { closeDb, isDatabaseUp } from '../src/db/db.ts';
import { loadSession } from '../src/db/sessions.ts';
import { directorContext } from '../src/llm/director.ts';
import { isLocalUp } from '../src/llm/local.ts';
import { actInCombat, climbFloor, getGame, newGame, takeTurn } from '../src/server/game.ts';
import type { GameView } from '../src/server/game.ts';
import { PLAYER } from '../src/social/edge.ts';
import { holderOf, priceOf, TRUST_TO_SELL } from '../src/world/holding.ts';
import { activeRegion, signposted } from '../src/world/travel.ts';

const argv = process.argv.slice(2);
const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const TARGET = Number(arg('--to') ?? 22);
const SEED = Number(arg('--seed') ?? 20260919);
/** Skip earning coin and buying: climbing needs no fight, so this checks the bands alone. */
const NO_BUY = argv.includes('--no-buy');
/** Fights to try for coin on one floor before moving on: about what a settlement costs (live, ~10). */
const FIGHTS_PER_FLOOR = 14;
/** Turns spent winning a holder's trust before trying to buy. */
const COURTING_TURNS = 5;

const t0 = Date.now();
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m]`, ...parts);
const finding = (text: string) => log(`FINDING ${text}`);

const stateOf = async (id: string) => (await loadSession(id))!.state;

/**
 * Every server call, caught: one failed turn is a FINDING, not the end of the run.
 * The web route turns the same throw into a 500 the player sees.
 */
async function safely<T>(what: string, call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (e) {
    finding(`${what} threw: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
const turn = (id: string, input: string, mode: 'exploration' | 'conversation') =>
  safely(`turn "${input.slice(0, 50)}"`, () => takeTurn(id, input, mode));

/** The lines of the Director's brief worth watching: time, holder, echoes, lines. */
async function told(id: string): Promise<string[]> {
  const brief = directorContext(await stateOf(id), []);
  return brief.split('\n').filter((l) => /^Time:|held by|years ago|'s line\)/.test(l));
}

/**
 * Walk to a place on this floor the way a player would: by typing "go to" the
 * names they can SEE. The probe may read the whole map to plan, but it only ever
 * names a place that is signposted from where it has been — typing a hidden name
 * is cheating, and the redaction wall rightly refuses the turn.
 */
async function walkTo(id: string, placeId: string): Promise<boolean> {
  for (let tries = 0; tries < 12; tries += 1) {
    const state = await stateOf(id);
    if (state.world.currentPlace === placeId) return true;
    const region = activeRegion(state.world);
    if (!region) return false;
    const known = signposted(region, state.world.currentPlace);
    const knowable = (pid: string) => known.has(pid) || Boolean(region.places.find((p) => p.id === pid)?.discovered);
    // The planned route on the real graph; aim for the furthest place on it we can name.
    const path = routeOnGraph(region.places, state.world.currentPlace, placeId);
    const aim = [...path].reverse().find(knowable);
    if (!aim) return false;
    const name = region.places.find((p) => p.id === aim)!.name;
    const r = await turn(id, `go to ${name}`, 'exploration');
    for (const why of r?.rejected ?? []) log(`  refused: ${why}`);
  }
  return (await stateOf(id)).world.currentPlace === placeId;
}

/** Fewest steps on the place graph, for the probe's own planning. */
function routeOnGraph(places: { id: string; connections: string[] }[], from: string, to: string): string[] {
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set(queue);
  while (queue.length) {
    const at = queue.shift()!;
    if (at === to) break;
    for (const next of places.find((p) => p.id === at)?.connections ?? []) {
      if (!seen.has(next)) { seen.add(next); prev.set(next, at); queue.push(next); }
    }
  }
  const path: string[] = [];
  for (let at: string | undefined = to; at && at !== from; at = prev.get(at)) path.unshift(at);
  return prev.has(to) ? path : [];
}

/** Drive an open fight to its end: attack when one is offered, else close in, else end the turn. */
async function fight(id: string, view: GameView): Promise<GameView> {
  for (let step = 0; step < 80 && view.combat && !view.combat.over; step += 1) {
    const c = view.combat;
    const me = c.fighters.find((f) => f.side === 'party' && !f.dead);
    const foes = c.fighters.filter((f) => f.side === 'foe' && !f.dead);
    const dist = (x: number, y: number) => Math.min(...foes.map((f) => Math.abs(f.x - x) + Math.abs(f.y - y)));
    const pick = c.options.find((o) => o.action.kind === 'attack')
      ?? c.options.find((o) => o.action.kind === 'spare')
      ?? c.options
        .filter((o) => o.action.kind === 'move')
        .sort((a, b) => {
          const pa = a.action.kind === 'move' ? a.action.to : { x: 0, y: 0 };
          const pb = b.action.kind === 'move' ? b.action.to : { x: 0, y: 0 };
          return dist(pa.x, pa.y) - dist(pb.x, pb.y);
        })
        .find((o) => o.action.kind === 'move' && me && foes.length
          && dist(o.action.to.x, o.action.to.y) < dist(me.x, me.y))
      ?? c.options.find((o) => o.action.kind === 'end')
      ?? c.options[0];
    if (!pick) break;
    const r = await safely('combat action', () => actInCombat(id, pick.action));
    if (!r) break;
    if (r.error) log(`  combat error: ${r.error}`);
    view = r.view;
    if (r.finished) {
      log(`  fight over: ${(r.closing ?? []).slice(-2).join(' / ')}`);
      break;
    }
  }
  return view;
}

async function earnCoin(id: string, want: number): Promise<number> {
  for (let n = 0; n < FIGHTS_PER_FLOOR; n += 1) {
    let view = (await getGame(id))!;
    if (view.character.coin >= want) break;
    // Rest when hurt, as a player would; a rest is the Director's to grant, so log whether it did.
    for (let tries = 0; tries < 2 && view.character.hp < view.character.maxHp * 0.9; tries += 1) {
      const before = view.character.hp;
      const r = await turn(id, 'rest', 'exploration');
      view = (await getGame(id))!;
      log(`  rest: hp ${before} -> ${view.character.hp}/${view.character.maxHp}${(r?.rejected ?? []).length ? ` (refused: ${r!.rejected.join('; ')})` : ''}`);
    }
    if (view.character.hp < view.character.maxHp * 0.5) {
      finding(`stopped fighting at hp ${view.character.hp}/${view.character.maxHp}: resting did not bring it back`);
      break;
    }
    const r = await turn(id, 'hunt', 'exploration');
    // A place hunted out stays so; hunt somewhere else, as a player would.
    if ((r?.rejected ?? []).some((why) => /nothing (left to hunt|is out hunting)/.test(why))) {
      const here = await stateOf(id);
      const region = activeRegion(here.world);
      const next = region?.places.find((p) => p.id === here.world.currentPlace)?.connections
        .find((c) => signposted(region, here.world.currentPlace).has(c));
      log(`  ${r!.rejected.join('; ')} — moving on${next ? ` to ${next}` : ''}`);
      if (next) await walkTo(id, next);
      continue;
    }
    if (r?.view.combat && !r.view.combat.over) {
      const after = await fight(id, r.view);
      log(`  coin now ${after.character.coin}, hp ${after.character.hp}/${after.character.maxHp}`);
      if (after.character.hp <= 0 || (await stateOf(id)).ended) {
        finding('the climber was defeated while earning coin');
        return after.character.coin;
      }
    } else {
      log(`  no fight started (${(r?.rejected ?? []).join('; ') || 'the Director did not start one'})`);
    }
  }
  return (await getGame(id))!.character.coin;
}

/** Court the holder of a settlement on this floor, then try to buy it. */
async function tryToBuy(id: string): Promise<boolean> {
  const state = await stateOf(id);
  const region = activeRegion(state.world);
  const settlement = region?.places.find((p) => p.kind === 'settlement' && holderOf(p, state.world.people));
  if (!region || !settlement) {
    log(`  no held settlement on floor ${region?.floor}`);
    return false;
  }
  const price = priceOf(region.floor);
  const coin = await earnCoin(id, price);
  if (coin < price) {
    finding(`floor ${region.floor}: only ${coin} coin after ${FIGHTS_PER_FLOOR} fights; a settlement costs ${price}`);
    return false;
  }
  if (!(await walkTo(id, settlement.id))) {
    finding(`could not walk to ${settlement.name} to buy it`);
    return false;
  }
  const here = await stateOf(id);
  const placeNow = activeRegion(here.world)?.places.find((p) => p.id === settlement.id) ?? settlement;
  const holderId = holderOf(placeNow, here.world.people);
  const holder = holderId ? here.world.people[holderId] : undefined;
  if (!holder) return false;
  log(`  ${settlement.name} is held by ${holder.name}; price ${price}, coin ${coin}`);

  for (let n = 0; n < COURTING_TURNS; n += 1) {
    const trust = (await getGame(id))!.people.find((p) => p.id === holder.id)?.trust ?? 0;
    if (trust >= TRUST_TO_SELL) break;
    await turn(id, `I help ${holder.name} with whatever they are struggling with`, 'conversation');
  }
  const trust = (await getGame(id))!.people.find((p) => p.id === holder.id)?.trust ?? 0;
  log(`  ${holder.name}'s trust: ${trust}`);

  // Talking can move you (live: the courting walked the climber out); buy standing in it.
  await walkTo(id, settlement.id);
  const offer = await turn(id, 'buy this settlement', 'exploration');
  for (const why of offer?.rejected ?? []) log(`  refused: ${why}`);
  const after = await stateOf(id);
  const now = activeRegion(after.world)?.places.find((p) => p.id === settlement.id);
  const mine = now ? holderOf(now, after.world.people) === PLAYER : false;
  if (mine) {
    finding(`BOUGHT ${settlement.name} on floor ${region.floor} for ${price} (coin now ${after.pc.coin})`);
    // O1's promise: a settlement you hold is somewhere to sleep, on any floor.
    const before = (await getGame(id))!.character;
    const slept = await turn(id, 'sleep', 'exploration');
    const now = (await getGame(id))!.character;
    finding(`long rest in the bought settlement: hp ${before.hp} -> ${now.hp}/${now.maxHp}${(slept?.rejected ?? []).length ? ` REFUSED: ${slept!.rejected.join('; ')}` : ''}`);
  }
  else if (!(offer?.rejected ?? []).some((r) => r.startsWith('acquirePlace'))) {
    finding('the Director never proposed acquirePlace for a plain offer to buy');
  }
  return mine;
}

async function main() {
  if (!(await isDatabaseUp())) throw new Error('Postgres is not reachable');
  if (!(await isLocalUp())) throw new Error('LM Studio is not reachable');

  log(`creating a world, seed ${SEED}, loop band + era band, climbing to floor ${TARGET}`);
  const id = await newGame('en', undefined, undefined, SEED, 'standard', 'dynamic', undefined, true, true);
  log(`session ${id}`);
  let bought = false;

  for (let floor = 0; floor < TARGET; floor += 1) {
    const state = await stateOf(id);
    const region = activeRegion(state.world);
    if (!region) throw new Error('no active region');

    if (!NO_BUY && !bought && region.floor >= 1) bought = await tryToBuy(id);

    // On the era band: do a deed on 21 so floor 22 has something to remember.
    if (region.floor === 21) {
      const someone = region.places.flatMap((p) => p.people).find((p) => state.world.people[p]?.alive !== false);
      if (someone) {
        const r = await turn(id, `I help ${state.world.people[someone].name} carry what they cannot`, 'conversation');
        log(`  deed on 21 → echoes stored: ${JSON.stringify((await stateOf(id)).world.echoes ?? [])} ${(r?.rejected ?? []).join('; ')}`);
      }
    }
    if (region.floor >= 20) for (const line of await told(id)) log(`  told on ${region.floor}: ${line.trim()}`);

    if (region.exit && !(await walkTo(id, region.exit))) {
      finding(`floor ${region.floor}: could not reach the way up (${region.exit})`);
      break;
    }
    const up = await safely('climb', () => climbFloor(id));
    if (!up || up.error) {
      finding(`floor ${region.floor}: climb failed: ${up?.error}`);
      break;
    }
    const arrived = activeRegion((await stateOf(id)).world);
    log(`floor ${arrived?.floor}: ${up.arrived}`);
    if ((await stateOf(id)).ended) {
      finding('the run ended');
      break;
    }
  }

  const end = await stateOf(id);
  log(`done at floor ${activeRegion(end.world)?.floor}, turn ${end.world.turn}, coin ${end.pc.coin}, bought: ${bought}`);
  log(`era band theme: ${JSON.stringify(end.world.strata?.era?.theme ?? null)}`);
  const lined = Object.values(end.world.people).filter((p) => p.line);
  log(`people with a family line: ${lined.map((p) => `${p.name} ← ${end.world.people[p.line!]?.name}`).join(', ') || 'none'}`);
  log(`session ${id}`);
}

main()
  .catch((e) => {
    console.error('PROBE FAILED:', e instanceof Error ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
