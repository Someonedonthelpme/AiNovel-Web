import { describeMental, describePersonality } from '../character/persona.ts';
import type { MentalState, Personality } from '../character/persona.ts';
import { describeChanges } from '../character/drift.ts';
import { pgFactRetriever } from '../db/facts.ts';
import { bootstrap } from '../db/db.ts';
import { appendTurn, createSession, loadEvents, loadSession, saveSnapshot, shouldSnapshot } from '../db/sessions.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { SocialRoll } from '../engine/roll.ts';
import { LOCAL_MODELS } from '../llm/local.ts';
import { LocalProvider } from '../llm/localProvider.ts';
import { climb, exitStatus } from '../play/climb.ts';
import {
  awaitingPlayer, combatOptions, concludeCombat, notableEvents, takeCombatAction,
} from '../play/combat.ts';
import type { CombatAction } from '../play/combat.ts';
import { initialPlayState } from '../play/state.ts';
import type { Mode, PlayState, TurnRecord } from '../play/state.ts';
import { playTurn, suggestedActions } from '../play/turn.ts';
import { runGenesis } from '../session/genesis.ts';
import { recordAnswer, startInterview, STAGES } from '../session/interview.ts';
import type { Language } from '../session/interview.ts';
import { derive } from '../session/sheet.ts';
import { layoutRegion, mapEdges } from '../world/layout.ts';
import { activeRegion } from '../world/travel.ts';

/**
 * Everything the web routes need, in one place.
 *
 * The routes stay thin deliberately: all of this is the same engine the terminal
 * script drives, so the two surfaces cannot drift apart in behaviour.
 */

const provider = () => new LocalProvider(LOCAL_MODELS.writer);

/* -------------------------------------------------------------------------- */
/* The shape the browser receives                                              */
/* -------------------------------------------------------------------------- */

export type MapNode = {
  id: string;
  name: string;
  kind: string;
  /** Undiscovered neighbours are drawn as unknowns rather than hidden. */
  known: boolean;
  current: boolean;
  reachable: boolean;
  x: number;
  y: number;
};

export type PersonView = {
  id: string;
  name: string;
  oneLine: string;
  trust: number;
  disposition: string[];
  condition: string[];
};

export type TranscriptEntry = {
  input: string;
  prose: string;
  roll: SocialRoll | null;
  classification: string;
};

export type FighterView = {
  id: string;
  name: string;
  side: 'party' | 'foe';
  hp: number;
  maxHp: number;
  ac: number;
  x: number;
  y: number;
  dead: boolean;
  dying: boolean;
  conditions: string[];
};

export type CombatView = {
  round: number;
  yourTurn: boolean;
  over: boolean;
  victor: string | null;
  grid: { width: number; height: number; walls: string[] };
  fighters: FighterView[];
  options: { label: string; action: CombatAction }[];
  /** Turning points since you last acted, not every swing. */
  log: string[];
};

export type GameView = {
  id: string;
  language: Language;
  turn: number;
  character: {
    name: string;
    background: string;
    level: number;
    hp: number;
    maxHp: number;
    ac: number;
    abilities: Record<string, number>;
    traits: string[];
    skills: { name: string; kind: string; description: string }[];
    personality: Personality;
    mental: MentalState;
    voice: { selfPronoun: string; underStress: string };
  };
  region: { floor: number; name: string; biome: string; danger: number };
  place: { id: string; name: string; description: string; affordances: string[] };
  map: { nodes: MapNode[]; edges: { from: string; to: string }[] };
  people: PersonView[];
  suggestions: string[];
  canClimb: boolean;
  canDescend: boolean;
  deepestFloor: number;
  factCount: number;
  transcript: TranscriptEntry[];
  /** Present only while a fight is happening. */
  combat: CombatView | null;
  ended: string | null;
};

function combatViewOf(state: PlayState, log: string[]): CombatView | null {
  const combat = state.combat;
  if (!combat) return null;
  return {
    round: combat.round,
    yourTurn: awaitingPlayer(state),
    over: combat.over,
    victor: combat.victor,
    grid: { width: combat.grid.width, height: combat.grid.height, walls: [...combat.grid.walls] },
    fighters: Object.values(combat.combatants).map((c) => ({
      id: c.id,
      name: c.name,
      side: c.side,
      hp: Math.max(0, c.hp),
      maxHp: c.maxHp,
      ac: c.ac,
      x: c.pos.x,
      y: c.pos.y,
      dead: c.dead,
      dying: c.dying,
      conditions: c.conditions.map((x) => x.kind),
    })),
    options: combatOptions(state),
    log,
  };
}

function viewOf(id: string, state: PlayState, transcript: TranscriptEntry[], combatLog: string[] = []): GameView {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  const d = derive(state.sheet);
  const here = new Set(place?.connections ?? []);

  const positions = new Map(region ? layoutRegion(region).map((p) => [p.id, p]) : []);
  const nodes: MapNode[] = (region?.places ?? []).map((p) => {
    const pos = positions.get(p.id);
    const known = p.discovered || p.id === state.world.currentPlace || here.has(p.id);
    return {
      id: p.id,
      // A place you have not been to yet is a shape on the map, not a name.
      name: known ? p.name : '?',
      kind: p.kind,
      known,
      current: p.id === state.world.currentPlace,
      reachable: here.has(p.id),
      x: pos?.x ?? 50,
      y: pos?.y ?? 50,
    };
  });

  const exits = exitStatus(state);

  return {
    id,
    language: state.world.language,
    turn: state.world.turn,
    character: {
      name: state.sheet.name,
      background: state.sheet.background.name,
      level: state.sheet.level,
      hp: state.pc.hp,
      maxHp: state.pc.maxHp,
      ac: d.ac,
      abilities: d.abilities,
      traits: state.sheet.traits,
      skills: d.skills.map((s) => ({ name: s.name, kind: s.kind, description: s.description })),
      personality: state.sheet.personality,
      mental: state.sheet.mental,
      voice: { selfPronoun: state.sheet.voice.selfPronoun, underStress: state.sheet.voice.underStress },
    },
    region: {
      floor: region?.floor ?? 0,
      name: region?.name ?? '',
      biome: region?.biome ?? '',
      danger: region?.danger ?? 0,
    },
    place: {
      id: place?.id ?? '',
      name: place?.name ?? '',
      description: place?.description ?? '',
      affordances: place?.affordances ?? [],
    },
    map: { nodes, edges: region ? mapEdges(region) : [] },
    people: (place?.people ?? [])
      .map((pid) => state.world.people[pid])
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.alive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        oneLine: p.oneLine,
        trust: p.trust,
        disposition: describePersonality(p.personality),
        condition: describeMental(p.mental),
      })),
    suggestions: suggestedActions(state),
    canClimb: exits.canClimb,
    canDescend: exits.canDescend,
    deepestFloor: state.world.deepestFloor,
    factCount: state.world.facts.length,
    transcript,
    combat: combatViewOf(state, combatLog),
    ended: state.ended?.reason ?? null,
  };
}

/**
 * Fights in progress, held in memory between requests.
 *
 * A fight is ONE event in the log, and its record can only be written once the
 * decisions are known — so the encounter lives here until it resolves. A server
 * restart mid-fight loses that turn, which for a local single-player game is a
 * fair trade against writing a half-finished fight into the history.
 */
type ActiveFight = { state: PlayState; draft: TurnRecord; actions: CombatAction[]; log: string[] };

/**
 * Held on `globalThis` rather than in a module variable.
 *
 * Next gives route handlers and server components separate module instances, so
 * a plain module-level Map produces TWO of them: the API would start a fight the
 * page could not see. The same reason the pg pool is a singleton.
 */
const fightStore = globalThis as typeof globalThis & { __towerFights?: Map<string, ActiveFight> };
const fights: Map<string, ActiveFight> = (fightStore.__towerFights ??= new Map());

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

const ANSWERS: Record<string, Record<Language, string>> = {
  world: {
    en: 'A drowned coast where the sea never went back down, and the tower is the only dry thing left.',
    th: 'ชายฝั่งที่น้ำท่วมไม่เคยลด และหอคอยคือที่แห้งแห่งเดียวที่เหลืออยู่',
  },
  character: {
    en: 'A harbour guard who lost a sibling on the third floor and has been paying their debts since.',
    th: 'ทหารยามท่าเรือที่เสียน้องไปบนชั้นสาม และใช้หนี้ของเขามาตั้งแต่นั้น',
  },
  drive: {
    en: 'They want the body back, and are leaving behind a family that blames them.',
    th: 'เขาอยากได้ร่างคืน และกำลังทิ้งครอบครัวที่โทษเขาไว้ข้างหลัง',
  },
  review: { en: 'ready', th: 'พร้อมแล้ว' },
};

/** Session Zero from a premise. Slow — one full generation pass. */
export async function newGame(language: Language, answers?: Partial<Record<string, string>>): Promise<string> {
  await bootstrap();
  let interview = startInterview(language);
  for (const stage of STAGES) {
    interview = recordAnswer(interview, answers?.[stage] ?? ANSWERS[stage][language]).interview;
  }

  const genesis = await runGenesis(provider(), interview, Date.now() % 2147483647);
  const id = await createSession(genesis.world, genesis.sheet, genesis.premise);
  await saveSnapshot(id, initialPlayState(genesis.world, genesis.sheet));
  return id;
}

async function transcriptOf(id: string, limit = 30): Promise<TranscriptEntry[]> {
  const events = await loadEvents(id);
  return events
    .filter((e): e is TurnRecord => e.kind === 'turn')
    .slice(-limit)
    .map((t) => ({ input: t.input, prose: t.prose, roll: t.roll, classification: t.classification }));
}

export async function getGame(id: string): Promise<GameView | null> {
  await bootstrap();

  // A fight in progress is not in the database yet — it becomes one event only
  // when it resolves. Without this, reloading the page mid-fight would drop the
  // player back into the scene with the encounter invisibly still running.
  const fight = fights.get(id);
  if (fight) return viewOf(id, fight.state, await transcriptOf(id), fight.log);

  const loaded = await loadSession(id);
  if (!loaded) return null;
  return viewOf(id, loaded.state, await transcriptOf(id));
}

export type TurnOutcomeView = {
  view: GameView;
  prose: string;
  roll: SocialRoll | null;
  /** Dispositions that shifted, phrased for the player. */
  shifts: string[];
  rejected: string[];
  registerFailed: string[];
};

export async function takeTurn(id: string, input: string, mode: Mode): Promise<TurnOutcomeView | null> {
  await bootstrap();
  const loaded = await loadSession(id);
  if (!loaded) return null;

  const state = loaded.state;
  const recent = (await transcriptOf(id, 3)).map((t) => t.prose);

  const result = await playTurn(
    {
      director: provider(),
      writer: provider(),
      rng: mulberry32(state.world.seed + state.world.turn),
      retrieveFacts: pgFactRetriever(id),
    },
    state,
    input,
    mode,
    recent,
  );

  // A fight is one event, and its record cannot be written until the decisions
  // are known. Hold it open and let the caller drive it.
  if (result.state.combat && !result.state.combat.over) {
    fights.set(id, { state: result.state, draft: result.record, actions: [], log: [] });
    return {
      view: viewOf(id, result.state, await transcriptOf(id), []),
      prose: result.record.prose,
      roll: result.record.roll,
      shifts: describeChanges(result.shifts),
      rejected: result.rejected,
      registerFailed: result.writer.checks.filter((c) => !c.check.ok).map((c) => c.person),
    };
  }

  const seq = await appendTurn(id, result.record);
  if (shouldSnapshot(seq)) await saveSnapshot(id, result.state);

  return {
    view: viewOf(id, result.state, await transcriptOf(id)),
    prose: result.record.prose,
    roll: result.record.roll,
    shifts: describeChanges(result.shifts),
    rejected: result.rejected,
    registerFailed: result.writer.checks.filter((c) => !c.check.ok).map((c) => c.person),
  };
}

export type ClimbOutcomeView = { view: GameView; error: string | null; arrived: string | null };

export async function climbFloor(id: string): Promise<ClimbOutcomeView | null> {
  await bootstrap();
  const loaded = await loadSession(id);
  if (!loaded) return null;

  const result = await climb(provider(), loaded.state);
  if (result.error) {
    return { view: viewOf(id, loaded.state, await transcriptOf(id)), error: result.error, arrived: null };
  }

  // A new floor is a large change; snapshot rather than replay it later.
  await saveSnapshot(id, result.state);
  const region = activeRegion(result.state.world);
  return {
    view: viewOf(id, result.state, await transcriptOf(id)),
    error: null,
    arrived: region ? `${region.name} — ${region.biome}` : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Fighting                                                                    */
/* -------------------------------------------------------------------------- */

export type CombatStepView = { view: GameView; error: string | null; finished: boolean };

/**
 * One decision in a fight.
 *
 * When the encounter resolves, the whole thing is written to the log as a single
 * turn carrying the decisions that were made — so a reload replays the same
 * fight rather than a differently unlucky one.
 */
export async function actInCombat(id: string, action: CombatAction): Promise<CombatStepView | null> {
  await bootstrap();
  const fight = fights.get(id);
  if (!fight) return null;

  const step = takeCombatAction(fight.state, action);
  if (step.error) {
    return {
      view: viewOf(id, fight.state, await transcriptOf(id), fight.log),
      error: step.error,
      finished: false,
    };
  }

  fight.state = step.state;
  fight.actions.push(action);
  fight.log = [...fight.log, ...notableEvents(step.events)];

  if (fight.state.combat && !fight.state.combat.over) {
    fights.set(id, fight);
    return { view: viewOf(id, fight.state, await transcriptOf(id), fight.log), error: null, finished: false };
  }

  // Over. Fold the consequences out, write the turn, and forget the encounter.
  const outcome = concludeCombat(fight.state);
  const record: TurnRecord = { ...fight.draft, combatActions: fight.actions };
  const seq = await appendTurn(id, record);
  await saveSnapshot(id, outcome.state);
  fights.delete(id);

  const tail = [
    ...fight.log,
    outcome.victor === 'party'
      ? `You are still standing. ${outcome.killed.length} down.`
      : 'You do not get back up.',
  ];
  void seq;

  return { view: viewOf(id, outcome.state, await transcriptOf(id), tail), error: null, finished: true };
}

/** Whether a fight is waiting on the player, e.g. after a page reload. */
export const hasActiveFight = (id: string): boolean => fights.has(id);
