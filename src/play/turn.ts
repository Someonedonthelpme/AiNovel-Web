import { trustToward } from '../social/edge.ts';
import { abilityMod } from '../combat/types.ts';
import { edgeFor } from '../skills/active.ts';
import { activeSkills } from '../session/sheet.ts';
import type { Rng } from '../engine/roll.ts';
import { roll } from '../engine/roll.ts';
import { mergeDeltas, runDirector, runParley, toWorldDelta } from '../llm/director.ts';
import type { DirectorOutput } from '../llm/director.ts';
import type { Provider } from '../llm/provider.ts';
import { assertNoLeak, toWriterView } from '../llm/redact.ts';
import { runWriter } from '../llm/writer.ts';
import type { WriterResult } from '../llm/writer.ts';
import { finalAbilities } from '../session/sheet.ts';
import { displayNames, humanise } from '../world/naming.ts';
import { activeRegion, signposted, walkRoute } from '../world/travel.ts';
import { drawMap, fieldEnds, positionOf, tileSeconds } from '../world/map.ts';
import type { GameMap, MapId } from '../world/map.ts';
import { walkAlong, walkToTile } from './walker.ts';
import type { Then } from './walker.ts';
import { holderOf, priceOf } from '../world/holding.ts';
import { applyTurn, personRef, validateDelta } from './delta.ts';
import { describeChanges } from '../character/drift.ts';
import type { AxisChange } from '../character/drift.ts';
import type { Mode, PlayState, Stop, TurnRecord, WorldDelta } from './state.ts';
import { beginEncounter, fightOpen, hearsWords } from './combat.ts';
import type { CombatAction } from './combat.ts';

/**
 * One turn, end to end.
 *
 * The order is the whole design in miniature: the Director proposes and commits
 * to every outcome, the ENGINE rolls, the engine validates what may be applied,
 * and only then does the Writer see a redacted view of the result. Nothing the
 * model says is trusted without being checked against the world first.
 */

export type TurnDeps = {
  director: Provider;
  writer: Provider;
  rng: Rng;
  /**
   * Established facts relevant to this turn — the canon guard. Injectable so
   * tests run without the embedding endpoint.
   */
  retrieveFacts?: (state: PlayState, input: string) => Promise<string[]>;
  /** The map a walk crosses: the session's stored copy (W3). Defaults to drawing it from the seed. */
  mapOf?: (id: MapId) => GameMap | Promise<GameMap>;
};

export type TurnResult = {
  state: PlayState;
  record: TurnRecord;
  writer: WriterResult;
  /** What the Director asked for and did not get. */
  rejected: string[];
  /** Dispositions that shifted this turn. Usually empty; a story beat when not. */
  shifts: AxisChange[];
};

/** Cheap default: the most recently established facts, no network needed. */
const recentFacts = async (state: PlayState): Promise<string[]> =>
  state.world.facts.slice(-6).map((f) => f.text);

/**
 * Legal things to do here, straight from the world.
 *
 * The "prompt or suggestion" promise costs no model call: a place already
 * declares its affordances, and its connections are already the legal moves.
 */
export function suggestedActions(state: PlayState): string[] {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  if (!place) return [];

  const moves = place.connections
    .map((id) => region?.places.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => `Go to ${p.name}`);

  const talk = place.people
    .map((id) => state.world.people[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.alive)
    .map((p) => `Talk to ${p.name}`);

  // Worlds generated before `humanisePlaces` existed still carry affordances
  // like "climb stair_tower"; these are the player's own action chips.
  const names = displayNames(region?.places ?? [], state.world.people);
  const affordances = place.affordances.map((a) => humanise(a, names));

  return [...affordances, ...talk, ...moves];
}

/**
 * A person who distrusts you resists harder. Uses trust rather than inventing
 * ability scores for every passer-by.
 */
function oppositionOf(state: PlayState, personId: string): { id: string; ability: string; modifier: number } | null {
  const person = state.world.people[personId];
  if (!person) return null;
  const trust = trustToward(state.world.edges, person.id);
  return { id: person.id, ability: 'resolve', modifier: Math.max(0, -trust) };
}

/** The person a check is rolled against, resolved like any person the model names. */
const opposedBy = (state: PlayState, said: string) => {
  const who = personRef(state, said);
  return 'id' in who ? oppositionOf(state, who.id) : null;
};

/** Pick the branch the Director committed to before the dice were thrown. */
export function outcomeFor(output: DirectorOutput, tier: 'miss' | 'partial' | 'hit') {
  if (tier === 'hit') return output.check.onHit;
  if (tier === 'partial') return output.check.onPartial;
  return output.check.onMiss;
}

export async function playTurn(
  deps: TurnDeps,
  state: PlayState,
  input: string,
  mode: Mode,
  recentTurns: string[] = [],
): Promise<TurnResult> {
  // A typed "go to X" is walked by the ENGINE, and never reaches the model
  // (DESIGN 6c §2d): the Director refused an adjacent stair three times live.
  const route = walkRoute(state.world, input);
  if (route) return walked(deps, state, input, mode, route);
  // So are a rest and a hunt: the probe found the Director starting no fight on
  // five "attack" turns in six, and rest reachable only when the model proposed it.
  const act = engineAct(state, input);
  if (act) return acted(state, input, mode, act);

  const canonFacts = await (deps.retrieveFacts ?? recentFacts)(state, input);
  const output = await runDirector(deps.director, state, input, mode, canonFacts);

  // --- resolve, in code -----------------------------------------------------
  let rolled = null as ReturnType<typeof roll> | null;
  let delta: WorldDelta = toWorldDelta(output.delta);
  let narrate: string | null = null;

  if (output.check?.required) {
    const abilities = finalAbilities(state.sheet, state.pc.inventory);
    const ability = output.check.ability as keyof typeof abilities;
    // Social and utility skills finally pay here. "Read the Ground" is worth
    // carrying because the Director asking for wisdom is when it applies.
    const edge = edgeFor(activeSkills(state.sheet), ability);
    rolled = roll(deps.rng, {
      ability: output.check.ability,
      modifier: abilityMod(abilities[ability] ?? 10) + edge,
      vs: output.check.vsPerson ? opposedBy(state, output.check.vsPerson) : null,
    });
    const chosen = outcomeFor(output, rolled.tier);
    delta = mergeDeltas(delta, toWorldDelta(chosen.delta));
    narrate = chosen.narrate;
  }

  // --- the engine decides what is allowed -----------------------------------
  const validated = validateDelta(state, delta);
  // Resolved like any person the model names; an unknown one is nobody, not a string.
  const addressedRef = output.addressedPerson?.trim() ? personRef(state, output.addressedPerson.trim()) : null;
  const addressed = addressedRef && 'id' in addressedRef ? addressedRef.id : null;

  // The record is built BEFORE the prose, because the world has to move before
  // the Writer can describe it. Prose is attached afterwards.
  const draft: TurnRecord = {
    kind: 'turn',
    input,
    mode,
    classification: output.classification,
    addressed,
    roll: rolled,
    delta: validated.delta,
    rejected: validated.rejected,
    prose: '',
  };

  const applied = applyTurn(state, draft);
  const next = applied.state;

  // --- the writer sees only what the player has earned ----------------------
  // Only a conversation has a speaker; exploration is narration.
  const speaking = mode === 'conversation' && addressed && next.world.people[addressed] ? addressed : null;

  const view = toWriterView(next, {
    brief: output.brief,
    speaking,
    outcome: rolled && narrate ? { tier: rolled.tier, narrate } : null,
    recentTurns,
    canonFacts,
    shifts: describeChanges(applied.shifts),
  });
  assertNoLeak(view, next.world);

  const written = await runWriter(deps.writer, view);

  const record: TurnRecord = { ...draft, prose: written.prose };

  return { state: next, record, writer: written, rejected: validated.rejected, shifts: applied.shifts };
}

/**
 * A walk, as a turn: one record carrying the route, applied like any other, and a
 * plain line of prose. No model is called — arrival narration waits for W3's stops.
 */
export type TileWalk = { state: PlayState; record: TurnRecord | null; then: Then | null; error: string | null };

/**
 * A click on the map you stand on (W4a): walk there, no typing and no model.
 * The tile is checked HERE, at the edge — it must be on your map, inside it and
 * not a wall — and a bad one is refused with a reason and nothing moves.
 */
export async function walkTile(deps: TurnDeps, state: PlayState, target: { map: MapId; x: number; y: number }): Promise<TileWalk> {
  const refuse = (error: string): TileWalk => ({ state, record: null, then: null, error });
  if (state.ended) return refuse('the story has ended');
  if (state.combat) return refuse('not while fighting');
  const start = positionOf(state.world);
  if (target.map !== start.map) return refuse(`"${target.map}" is not the map you are on`);
  const mapOf = deps.mapOf ?? ((id: MapId) => drawMap(state.world, id));
  const map = await mapOf(start.map);
  const { x, y } = target;
  if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= map.rows.length || x < 0 || x >= map.rows[0].length) {
    return refuse(`(${x}, ${y}) is outside the map`);
  }
  if (tileSeconds(map, { x, y }) === Infinity) return refuse(`(${x}, ${y}) is a wall`);

  const { walkTo, then } = await walkToTile(state, target, mapOf);
  const record: TurnRecord = {
    kind: 'turn', input: '', mode: 'exploration', classification: 'NEUTRAL', addressed: null, roll: null,
    delta: { walkTo }, rejected: [], prose: '',
  };
  const applied = applyTurn(state, record);
  const places = activeRegion(state.world)?.places ?? [];
  const entered = places.find((p) => p.id === walkTo.through[walkTo.through.length - 1])?.name;
  const th = state.world.language === 'th';
  // Every click says something: an empty line is an empty transcript entry.
  const onto = fieldEnds(walkTo.map)?.find((p) => p !== state.world.currentPlace);
  const road = places.find((p) => p.id === onto)?.name;
  const standing = places.find((p) => p.id === state.world.currentPlace)?.name ?? '';
  const prose = walkTo.stop !== 'arrived'
    ? (th ? STOP_LINES[walkTo.stop].th(entered ?? 'ปลายทาง') : STOP_LINES[walkTo.stop].en(entered ?? 'where you were going'))
    : entered ? (th ? STOP_LINES.arrived.th(entered) : STOP_LINES.arrived.en(entered))
    : road ? (th ? `คุณออกเดินทางไปทาง${road}` : `You set out toward ${road}.`)
    : th ? `คุณเดินไปในบริเวณ${standing}` : `You walk across ${standing}.`;
  return { state: applied.state, record: { ...record, prose }, then, error: null };
}

/** What an engine-walked turn says, by why it stopped. Closed, like `STOPS`. */
const STOP_LINES: Record<Stop, { en: (to: string) => string; th: (to: string) => string }> = {
  arrived: { en: (to) => `You walk to ${to}.`, th: (to) => `คุณเดินไปถึง${to}` },
  nightfall: { en: (to) => `Night falls before you reach ${to}.`, th: (to) => `ค่ำลงก่อนคุณจะถึง${to}` },
  hungry: { en: (to) => `Hunger stops you on the way to ${to}.`, th: (to) => `ความหิวทำให้คุณต้องหยุดระหว่างทางไป${to}` },
  weary: { en: (to) => `You are too tired to go on toward ${to}.`, th: (to) => `คุณเหนื่อยเกินกว่าจะเดินต่อไปยัง${to}` },
  encounter: { en: () => 'Someone has come for you.', th: () => 'มีคนตามมาหาคุณ' },
};

async function walked(deps: TurnDeps, state: PlayState, input: string, mode: Mode, route: string[]): Promise<TurnResult> {
  const walkTo = await walkAlong(state, route, deps.mapOf ?? ((id) => drawMap(state.world, id)));
  const record: TurnRecord = {
    kind: 'turn', input, mode, classification: 'NEUTRAL', addressed: null, roll: null,
    delta: { walkTo }, rejected: [], prose: '',
  };
  const applied = applyTurn(state, record);
  const goal = activeRegion(state.world)?.places.find((p) => p.id === route[route.length - 1])?.name ?? '';
  const line = STOP_LINES[walkTo.stop];
  const prose = state.world.language === 'th' ? line.th(goal) : line.en(goal);
  return {
    state: applied.state,
    record: { ...record, prose },
    writer: { prose, checks: [], regenerated: false },
    rejected: [],
    shifts: applied.shifts,
  };
}

/**
 * The acts with one right answer, recognised whole — "rest" but not "rest
 * assured", "hunt" but not "attack the guard", which is a social act with a
 * person in it and stays the Director's. Closed: a phrase nobody listed is speech.
 */
const REST = /^\s*(?:(?:take\s+a\s+)?(short|long)\s+rest|(rest)|(sleep)|(พัก(?:ผ่อน)?)|(นอน(?:หลับ)?))\s*[.!]?\s*$/i;
const HUNT = /^\s*(?:hunt|go hunting|look for (?:a fight|trouble)|ออกล่า|ล่า(?:สัตว์)?)\s*[.!]?\s*$/i;

type EngineAct = { proposed: WorldDelta; line: { en: string; th: string } };

/**
 * "buy X" (approved 2026-09-19): X names a place you can know of, or "this
 * settlement" / "here" means where you stand. O1's own rules then decide it,
 * through `validateDelta` — so "buy" from the market is refused as "not here",
 * and "buy some bread" names no place and stays speech. Free-form negotiation
 * still reaches the Director, and is what earns the trust a sale needs.
 */
const BUY = /^\s*(?:buy|ซื้อ)\s*(.+?)\s*[.!]?\s*$/i;
const HERE = /^(?:this (?:settlement|town|place)|here|ที่นี่)$/i;

function buyAct(state: PlayState, input: string): EngineAct | null {
  const said = BUY.exec(input)?.[1];
  const region = activeRegion(state.world);
  if (!said || !region) return null;
  const known = signposted(region, state.world.currentPlace);
  const plainName = (n: string) => n.trim().toLowerCase().replace(/^the\s+/, '');
  const target = HERE.test(said.trim())
    ? region.places.find((p) => p.id === state.world.currentPlace)
    : region.places.find((p) => (p.discovered || known.has(p.id) || p.id === state.world.currentPlace)
      && plainName(p.name) === plainName(said));
  if (!target) return null;
  const holder = holderOf(target, state.world.people);
  const from = holder ? state.world.people[holder]?.name ?? holder : '';
  const price = priceOf(region.floor);
  return {
    proposed: { acquirePlace: target.id },
    line: { en: `You buy ${target.name} from ${from} for ${price} coin.`, th: `คุณซื้อ${target.name}จาก${from} ด้วยเงิน ${price} เหรียญ` },
  };
}

function engineAct(state: PlayState, input: string): EngineAct | null {
  const rest = REST.exec(input);
  if (rest) {
    const long = rest[1]?.toLowerCase() === 'long' || Boolean(rest[3]) || Boolean(rest[5]);
    return long
      ? { proposed: { rest: 'long' }, line: { en: 'You sleep through the night.', th: 'คุณนอนหลับจนข้ามคืน' } }
      : { proposed: { rest: 'short' }, line: { en: 'You rest a while.', th: 'คุณพักสักครู่' } };
  }
  const buy = buyAct(state, input);
  if (buy) return buy;
  if (HUNT.test(input)) {
    return { proposed: { startCombat: true, startedBy: 'player' }, line: { en: 'You go looking for trouble.', th: 'คุณออกล่า' } };
  }
  return null;
}

/**
 * Why a hunt the rules allow would still find nobody, or null when it would.
 *
 * A DRY RUN of the encounter, which is a pure function of state: live, a place
 * hunted out — a thinned crowd stays gone — accepted every later hunt, opened no
 * fight, and said "You go looking for trouble." A place whose crowd is spent says
 * so; one whose kinds are simply not out (season, hours) says that instead.
 */
function nothingToHunt(state: PlayState): { reason: string; line: { en: string; th: string } } | null {
  if (fightOpen(beginEncounter(state, 'player'))) return null;
  const crowd = state.world.populations?.[state.world.currentPlace];
  return Array.isArray(crowd) && crowd.length === 0
    ? { reason: 'nothing left to hunt here', line: { en: 'Nothing here is left to hunt; try somewhere else.', th: 'ที่นี่ไม่เหลืออะไรให้ล่าแล้ว ลองไปที่อื่นดู' } }
    : { reason: 'nothing is out hunting here now', line: { en: 'Nothing is out hunting here right now.', th: 'ตอนนี้ไม่มีอะไรออกมาล่าแถวนี้' } };
}

/**
 * An engine act, as a turn: the proposal goes through `validateDelta` like the
 * Director's would, so the rules that already decide a rest or a fight decide
 * this one, and a refusal carries their reason. A refused act still spends the
 * turn — you tried. No model is called.
 */
function acted(state: PlayState, input: string, mode: Mode, act: EngineAct): TurnResult {
  const validated = validateDelta(state, act.proposed);
  const empty = validated.delta.startCombat ? nothingToHunt(state) : null;
  if (empty) {
    delete validated.delta.startCombat;
    delete validated.delta.startedBy;
    validated.rejected.push(`startCombat: ${empty.reason}`);
    act = { ...act, line: empty.line };
  }
  const record: TurnRecord = {
    kind: 'turn', input, mode, classification: 'NEUTRAL', addressed: null, roll: null,
    delta: validated.delta, rejected: validated.rejected, prose: '',
  };
  const applied = applyTurn(state, record);
  const done = validated.rejected.length === 0;
  const prose = done || empty ? act.line[state.world.language] : validated.rejected.join('; ');
  return {
    state: applied.state,
    record: { ...record, prose },
    writer: { prose, checks: [], regenerated: false },
    rejected: validated.rejected,
    shifts: applied.shifts,
  };
}

type Parley = Extract<CombatAction, { kind: 'parley' }>;

/**
 * A word in a fight, heard live (6b stage 8b): the same order as a turn — the
 * model commits to every answer, the ENGINE rolls, and the tier picks one.
 *
 * Whatever roll and verdict the action arrived with are discarded: it came from
 * the client, and a verdict it could set would be a win without a roll. What is
 * returned is what the log stores, so replay never asks again.
 */
export async function hearParley(provider: Provider, rng: Rng, state: PlayState, action: Parley): Promise<Parley> {
  const foe = state.combat?.combatants[action.target];
  // Nobody to hear it: no call. `takeCombatAction` refuses the action itself.
  if (!foe || !hearsWords(state, foe)) return { ...action, roll: null, verdict: 'refuses' };

  const said = await runParley(provider, state, foe, action.say);
  const abilities = finalAbilities(state.sheet, state.pc.inventory);
  const rolled = roll(rng, {
    ability: said.ability,
    modifier: abilityMod(abilities[said.ability] ?? 10) + edgeFor(activeSkills(state.sheet), said.ability),
  });
  const verdict = { hit: said.onHit, partial: said.onPartial, miss: said.onMiss }[rolled.tier];
  return { ...action, roll: rolled, verdict };
}
