import { describeMental, describePersonality } from '../character/persona.ts';
import { loreFor } from '../play/lorebook.ts';
import { knowsLore } from '../play/lore.ts';
import { dispositionOf } from '../character/persona.ts';
import { carriedWeight } from '../items/types.ts';
import type { Needs, Personality } from '../character/persona.ts';
import { describeChanges } from '../character/drift.ts';
import { pgFactRetriever } from '../db/facts.ts';
import { bootstrap } from '../db/db.ts';
import { appendTurn, createSession, loadEvents, loadSession, saveSnapshot, shouldSnapshot } from '../db/sessions.ts';
import { mapFor } from '../db/maps.ts';
import { drawMap, positionOf } from '../world/map.ts';
import { gridOf } from './grid.ts';
import { peopleHere } from '../play/onroad.ts';
import type { GridView } from './grid.ts';
import { floorMapOf, minimapOf, towerOf } from './views.ts';
import type { FloorMapView, MinimapView, TowerView } from './views.ts';
import { mulberry32 } from '../engine/roll.ts';
import type { SocialRoll } from '../engine/roll.ts';
import { LOCAL_MODELS } from '../llm/local.ts';
import { LocalProvider } from '../llm/localProvider.ts';
import { allocationOf, canAllocate, entryOpen, visibleNodes } from '../play/allocate.ts';
import { applySheetAction, contextOf, sheetRecord, treeFor } from '../play/sheetaction.ts';
import type { SheetAction } from '../play/sheetaction.ts';
import { progressOf } from '../play/traits.ts';
import { xpToNext } from '../play/progress.ts';
import { traitOriginOf, traitsFor } from '../play/traitbook.ts';
import { isEmergent } from '../play/emergent.ts';
import { visibleSignets } from '../play/signet.ts';
import { signetsFor } from '../play/signetbook.ts';
import { climb, exitStatus, godown, travelTo } from '../play/climb.ts';
import {
  awaitingPlayer, combatOptions, fightOpen, notableEvents, takeCombatAction,
} from '../play/combat.ts';
import { settleFight } from '../play/delta.ts';
import type { CombatAction } from '../play/combat.ts';
import { initialPlayState } from '../play/state.ts';
import type { Mode, PlayState, TurnRecord } from '../play/state.ts';
import { hearParley, playTurn, suggestedActions, walkTile } from '../play/turn.ts';
import { runGenesis } from '../session/genesis.ts';
import type { PresetName } from '../rules/ruleset.ts';
import type { SpeciesChoice } from '../character/species.ts';
import { recordAnswer, setDraft, startInterview, STAGES } from '../session/interview.ts';
import type { CharacterDraft } from '../session/interview.ts';
import type { Language } from '../session/interview.ts';
import { activeSkills, derive, carryCapacityFor } from '../session/sheet.ts';
import { canChooseSubclassOf, classOf, subclassOf } from '../character/classes.ts';
import type { ActiveSkill } from '../skills/active.ts';
import { magnitudeOf, purposes } from '../skills/effect.ts';
import type { Effect } from '../skills/effect.ts';
import { priceOfUse } from '../skills/pools.ts';
import { rulesOf } from '../rules/ruleset.ts';
import { trustToward } from '../social/edge.ts';
import { ceilingOf, conditionOfInstance, PRISTINE, weakestPart } from '../items/instance.ts';
import { partTypeOf } from '../items/parts.ts';
import { canEnchant, enchantCost, enhanceCost, ENCHANT_NAMES, nextRarity, refineCost, repairCost } from '../items/refine.ts';
import type { Ruleset } from '../rules/ruleset.ts';
import type { Item } from '../items/types.ts';
import { boardOf, findHolding, isContainer, placementsIn, spaceIn } from '../items/types.ts';
import type { Holding, Inventory } from '../items/types.ts';
import { activeRegion } from '../world/travel.ts';

/**
 * Everything the web routes need, in one place.
 *
 * The routes stay thin deliberately: all of this is the same engine the terminal
 * script drives, so the two surfaces cannot drift apart in behaviour.
 */

export const provider = () => new LocalProvider(LOCAL_MODELS.writer);

/* -------------------------------------------------------------------------- */
/* The shape the browser receives                                              */
/* -------------------------------------------------------------------------- */


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
    /** What you are hauling, against what you can. Overload costs movement. */
    carried: number;
    capacity: number;
    /** What is acting on you right now, outside a fight as well as inside one. */
    conditions: string[];
    abilities: Record<string, number>;
    traits: string[];
    skills: { name: string; description: string; effect: string; cost: number; pool: string }[];
    personality: Personality;
    needs: Needs;
    voice: { selfPronoun: string; underStress: string };
    xp: number;
    xpToNext: number;
    abilityPoints: number;
    skillPoints: number;
    coin: number;
    className: string | null;
    subclassName: string | null;
    /** Set once a subclass is available and unchosen — the panel prompts on it. */
    subclassChoices: { id: string; name: string; description: string; opens: string }[];
  };
  /** What the character panel shows. */
  inventory: {
    stacks: {
      id: string; name: string; description: string; kind: string; count: number;
      equipped: boolean; slot: string | null; usable: boolean; wearable: boolean;
      /** 1 is whole. A specific object can be worn through; a stack cannot. */
      condition: number;
      /** Which bag it is in, if it is in one. Null means in your own hands. */
      inside: string | null;
      /** A container, and what is left in it. Null when it is not one. */
      capacity: number | null;
      space: number | null;
      /**
       * The board inside it, and what is laid out on it.
       *
       * Sent as cells rather than as a mask, because the browser has no shape
       * module and should not grow one — this is the only place that needs to
       * know a board is not a rectangle.
       */
      board: { w: number; h: number; cells: [number, number][] } | null;
      placed: { id: string; name: string; cells: [number, number][] }[];
      /**
       * What it is made of, if it is made of anything.
       *
       * A fused piece is shown and cannot be taken off — the boundary is a fact
       * about the object, and a player should see where it is rather than
       * discover it by being refused.
       */
      parts: { id: string; name: string; condition: number; fused: boolean }[];
      /**
       * What has been put INTO it, and what the next step would cost.
       *
       * `enhanceResets` is sent so the panel can say what enhancing throws
       * away. The whole decision is that trade, and a button that quietly
       * discarded a +9 would be the worst kind of surprise.
       */
      refine: number | null;
      rarity: string | null;
      enchants: string[];
      canRefine: boolean;
      canEnchant: boolean;
      canEnhance: boolean;
      refineCost: number;
      enchantCost: number;
      enhanceCost: number;
      enhanceResets: boolean;
      canRepair: boolean;
      repairCost: number;
      /** What a smith could bring it back to, 0..1. Falls with every mending. */
      repairCeiling: number;
      /** Whether it has a history, and whether this character has read it. */
      hasLore: boolean; read: boolean;
    }[];
    equipped: Record<string, string>;
    /**
     * The paper-doll: every place THIS WORLD lets you wear something, filled or
     * not. Sent whole rather than derived in the panel, because the slot set is
     * a property of the world and the browser has no ruleset.
     */
    slots: { id: string; name: string; itemId: string | null; itemName: string | null; condition: number }[];
    /** The workings a milestone may buy. A closed list, so the panel offers only these. */
    workings: string[];
  };
  /** What the skills panel shows. Hidden nodes and Signets are absent, not greyed. */
  tree: {
    home: string;
    paths: string[];
    nodes: {
      id: string; name: string; description: string; kind: string; stat: string; path: string;
      x: number; y: number; connections: string[]; taken: boolean; reachable: boolean;
      /** Notables teach an active; the panel says so before you spend on it. */
      teaches: string | null;
      /** Which system grew this branch, so the card can say why it is there. */
      grafted: { kind: string; name: string } | null;
      /** Needs nothing held — you read your way in rather than walking. */
      freeStanding: boolean;
      /** Opens only when ALL of these are held. */
      requiresAll: string[];
    }[];
  };
  traits: {
    id: string; name: string; description: string; held: boolean;
    /** What you became. Present only once earned — see `traitsViewOf`. */
    note: string | null;
    progress: { label: string; have: number; need: number; met: boolean }[];
  }[];
  signets: { id: string; name: string; description: string; held: boolean; available: boolean; augments: string }[];
  region: { floor: number; name: string; biome: string; danger: number };
  place: { id: string; name: string; description: string; affordances: string[] };
  /** The floor map: discovered places only, and view-only (W4b). */
  map: FloorMapView;
  /** The centre view: a window of the map you stand on, and its doors (W4a). */
  grid: GridView | null;
  /** The whole map you stand on, shrunk (W4b). */
  minimap: MinimapView | null;
  tower: TowerView;
  people: PersonView[];
  suggestions: string[];
  canClimb: boolean;
  /**
   * The ways out that are not stairs, for a world that is not a stack.
   *
   * `here` is whether the player is standing at the one place it can be taken
   * from — the same rule the stair has, said for a road.
   */
  ways: { to: string; via: string; here: boolean }[];
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
    // Not over while somebody who yielded is waiting on you: the choice is shown as options.
    over: !fightOpen(state),
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

/**
 * The view, with the centre grid drawn from the session's STORED map — the one a
 * walk crosses — so what is shown and what is walked cannot disagree. Looking at
 * a map is entering it, so this stores it the first time.
 */
async function viewOf(id: string, state: PlayState, transcript: TranscriptEntry[], combatLog: string[] = []): Promise<GameView> {
  const view = baseViewOf(id, state, transcript, combatLog);
  if (!activeRegion(state.world)) return view;
  const at = positionOf(state.world);
  const map = await mapFor(id, at.map, () => drawMap(state.world, at.map));
  return { ...view, grid: gridOf(state, map), minimap: minimapOf(state, map) };
}

function baseViewOf(id: string, state: PlayState, transcript: TranscriptEntry[], combatLog: string[] = []): GameView {
  const region = activeRegion(state.world);
  const place = region?.places.find((p) => p.id === state.world.currentPlace);
  const d = derive(state.sheet, state.pc.inventory);

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
      carried: carriedWeight(state.pc.inventory),
      capacity: carryCapacityFor(state.sheet, state.pc.inventory),
      conditions: state.pc.conditions.map((c) => c.kind),
      abilities: d.abilities,
      traits: state.sheet.traits,
      // Actives, with what they do and what they take out of you — a skill the
      // player cannot see the cost of is one they will not plan around.
      skills: activeSkills(state.sheet).map((s) => {
        const { pool, cost } = priceOfUse(s, state.sheet, rulesOf(state.world));
        return { name: s.name, description: s.description, effect: describeEffect(s), cost, pool };
      }),
      personality: dispositionOf(state.sheet),
      needs: state.sheet.needs,
      voice: { selfPronoun: state.sheet.voice.selfPronoun, underStress: state.sheet.voice.underStress },
      xp: state.sheet.xp ?? 0,
      xpToNext: xpToNext(state.sheet.level),
      abilityPoints: state.sheet.abilityPoints ?? 0,
      skillPoints: state.sheet.skillPoints ?? 0,
      coin: state.pc.coin,
      className: classOf(state.sheet)?.name[state.world.language] ?? null,
      subclassName: subclassOf(state.sheet)?.name[state.world.language] ?? null,
      // Offered only when it can actually be taken, so the panel never shows a
      // choice that would be refused.
      subclassChoices: canChooseSubclassOf(state.sheet.level, state.sheet)
        ? (classOf(state.sheet)?.subclasses ?? []).map((sub) => ({
            id: sub.id,
            name: sub.name[state.world.language],
            description: sub.description[state.world.language],
            opens: sub.opens,
          }))
        : [],
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
    map: floorMapOf(state),
    grid: null,
    minimap: null,
    tower: towerOf(state),
    // Out on a field this is who is in VIEW on it, not the people of the place
    // you set out from (W5).
    people: peopleHere(state)
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.alive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        oneLine: p.oneLine,
        trust: trustToward(state.world.edges, p.id),
        disposition: describePersonality(dispositionOf(p)),
        condition: describeMental(p.needs),
      })),
    inventory: inventoryViewOf(state),
    tree: treeViewOf(state),
    traits: traitsViewOf(state),
    signets: signetsViewOf(state),
    suggestions: suggestedActions(state),
    canClimb: exits.canClimb,
    ways: (activeRegion(state.world)?.exits ?? []).map((l) => ({
      to: l.to,
      via: l.via,
      here: state.world.currentPlace === l.via,
    })),
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
type ActiveFight = {
  /** Before the turn that opened the fight — its end is re-folded from here (`settleFight`). */
  pre: PlayState;
  state: PlayState;
  draft: TurnRecord;
  actions: CombatAction[];
  log: string[];
};

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
export async function newGame(
  language: Language,
  answers?: Partial<Record<string, string>>,
  draft?: CharacterDraft,
  seed?: number,
  /** Which ruleset this world plays by. Anything unknown falls back to STANDARD. */
  rules?: string,
  /** Whether the tower is frozen once authored. Anything else means dynamic. */
  structure?: string,
  /** How the climber's kind is chosen, as the client sent it. Checked by `speciesChoiceOf`. */
  species?: unknown,
  /** Whether floors 1–10 loop, as the client sent it. Checked by `loopBandOf`. */
  loop?: unknown,
  /** Whether floors 21–30 are eras, as the client sent it. Checked by `eraBandOf`. */
  era?: unknown,
): Promise<string> {
  await bootstrap();
  let interview = startInterview(language);
  for (const stage of STAGES) {
    interview = recordAnswer(interview, answers?.[stage] ?? ANSWERS[stage][language]).interview;
  }

  // Anything the player pinned down by hand outranks what the model proposes —
  // that is the whole contract of character creation. `runGenesis` already
  // honours the draft; this is where the page's choices reach it.
  if (draft && Object.keys(draft).length) interview = setDraft(interview, draft);

  /*
   * The seed comes from the creation page now, not from the clock.
   *
   * It has to: the class roster the player picked from was generated FROM this
   * seed, so drawing a different one here would hand them a world whose
   * classes are not the ones they were shown. The seed IS the world, and
   * deciding it at the last moment was always arbitrary.
   */
  // Cast at the boundary, not inside: `presetNamed` is the validator, and it
  // answers STANDARD for anything a client makes up.
  const genesis = await runGenesis(
    provider(), interview, seed ?? Date.now() % 2147483647, rules as PresetName | undefined ?? 'standard',
    structure === 'static' ? 'static' : 'dynamic',
    speciesChoiceOf(species),
    loopBandOf(loop),
    eraBandOf(era),
  );
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
  if (fight) return await viewOf(id, fight.state, await transcriptOf(id), fight.log);

  const loaded = await loadSession(id);
  if (!loaded) return null;
  return await viewOf(id, loaded.state, await transcriptOf(id));
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
      // A map is stored the first time a walk crosses it, and never redrawn (W2).
      mapOf: (map) => mapFor(id, map, () => drawMap(state.world, map)),
    },
    state,
    input,
    mode,
    recent,
  );

  // A fight is one event, and its record cannot be written until the decisions
  // are known. Hold it open and let the caller drive it.
  if (fightOpen(result.state)) {
    fights.set(id, { pre: state, state: result.state, draft: result.record, actions: [], log: [] });
    return {
      view: await viewOf(id, result.state, await transcriptOf(id), []),
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
    view: await viewOf(id, result.state, await transcriptOf(id)),
    prose: result.record.prose,
    roll: result.record.roll,
    shifts: describeChanges(result.shifts),
    rejected: result.rejected,
    registerFailed: result.writer.checks.filter((c) => !c.check.ok).map((c) => c.person),
  };
}

export type WalkOutcomeView = { view: GameView; error: string | null; prose: string; arrived: string | null };

/**
 * A click on the map (W4a): walk there, and if it was a stair or a way out, take
 * it. The walk is logged first, as its own turn, so a climb that fails still
 * leaves you standing on the stair. A traveller met on the way holds the fight
 * open exactly as a typed turn does.
 */
export async function walkOnMap(id: string, target: { map: string; x: number; y: number }): Promise<WalkOutcomeView | null> {
  await bootstrap();
  const fight = fights.get(id);
  if (fight) return { view: await viewOf(id, fight.state, await transcriptOf(id), fight.log), error: 'not while fighting', prose: '', arrived: null };
  const loaded = await loadSession(id);
  if (!loaded) return null;
  const state = loaded.state;

  const result = await walkTile(
    {
      director: provider(),
      writer: provider(),
      rng: mulberry32(state.world.seed + state.world.turn),
      mapOf: (map) => mapFor(id, map, () => drawMap(state.world, map)),
    },
    state,
    target,
  );
  if (result.error || !result.record) {
    return { view: await viewOf(id, state, await transcriptOf(id)), error: result.error, prose: '', arrived: null };
  }
  if (fightOpen(result.state)) {
    fights.set(id, { pre: state, state: result.state, draft: result.record, actions: [], log: [] });
    return { view: await viewOf(id, result.state, await transcriptOf(id), []), error: null, prose: result.record.prose, arrived: null };
  }
  const seq = await appendTurn(id, result.record);
  if (shouldSnapshot(seq)) await saveSnapshot(id, result.state);

  if (result.then) {
    const crossed = 'travel' in result.then
      ? await climbFloor(id, result.then.travel)
      : await climbFloor(id, undefined, result.then.climb === 'down');
    if (crossed) return { view: crossed.view, error: crossed.error, prose: result.record.prose, arrived: crossed.arrived };
  }
  return { view: await viewOf(id, result.state, await transcriptOf(id)), error: null, prose: result.record.prose, arrived: null };
}

export type ClimbOutcomeView = { view: GameView; error: string | null; arrived: string | null };

/**
 * How the client says the climber's kind is chosen — checked here, at the edge.
 *
 * Absent is the ordinary kind. Anything present must be one of the three shapes;
 * a malformed one is refused rather than quietly becoming "ordinary", which would
 * hand the player a character they did not ask for.
 */
export function speciesChoiceOf(raw: unknown): SpeciesChoice | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = raw as { pick?: unknown; describe?: unknown; decide?: unknown };
  if (typeof r.pick === 'string' && r.pick) return { pick: r.pick };
  if (typeof r.describe === 'string' && r.describe.trim()) return { describe: r.describe.trim().slice(0, 300) };
  if (r.decide === 'world') return { decide: 'world' };
  throw new Error(`species: expected { pick }, { describe } or { decide: 'world' }, got ${JSON.stringify(raw).slice(0, 80)}`);
}

/**
 * Where a climb request asks to go: a named way out, or the stair when it names none.
 *
 * An empty body is the stair — that is what a request without one has always
 * meant. A body that does not parse is REFUSED: turning it into `{}` climbed the
 * stair, so a broken request moved the player instead of failing.
 */
/**
 * Whether the client asked for a loop band — checked here, at the edge. Absent is
 * no band; anything but a boolean is refused rather than read as one, which would
 * hand the player a world whose law they did not ask for.
 */
function bandOf(name: string, raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'boolean') return raw;
  throw new Error(`${name}: expected true or false, got ${JSON.stringify(raw).slice(0, 40)}`);
}
export const loopBandOf = (raw: unknown): boolean => bandOf('loop', raw);
/** Whether the client asked for an era band (floors 21–30), checked the same way. */
export const eraBandOf = (raw: unknown): boolean => bandOf('era', raw);

/** A click on the map, checked at the edge (W4a): a map id and two whole numbers, or refused. */
export function walkTarget(text: string): { target?: { map: string; x: number; y: number }; error?: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: `malformed walk request: ${text.slice(0, 80)}` };
  }
  const { map, x, y } = (body ?? {}) as { map?: unknown; x?: unknown; y?: unknown };
  if (typeof map !== 'string' || !map || !Number.isInteger(x) || !Number.isInteger(y)) {
    return { error: `a walk needs { map, x, y } with whole-number x and y, got ${text.slice(0, 80)}` };
  }
  return { target: { map, x: x as number, y: y as number } };
}

export function climbTarget(text: string): { to?: string; error?: string } {
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return { error: `malformed climb request: ${text.slice(0, 80)}` };
  }
  const to = (body as { to?: unknown } | null)?.to;
  return { to: typeof to === 'string' ? to : undefined };
}

/**
 * Cross out of this region.
 *
 * `to` names a way out that is not a stair; without it this is the stair up,
 * which is what every world had before regions could be anything but a stack.
 */
export async function climbFloor(id: string, to?: string, down = false): Promise<ClimbOutcomeView | null> {
  await bootstrap();
  const loaded = await loadSession(id);
  if (!loaded) return null;

  const result = to ? await travelTo(provider(), loaded.state, to)
    : down ? await godown(provider(), loaded.state) : await climb(provider(), loaded.state);
  if (result.error || !result.record) {
    return { view: await viewOf(id, loaded.state, await transcriptOf(id)), error: result.error, arrived: null };
  }

  // The crossing goes in the log, carrying the floor that was generated to make
  // it — a synchronous fold holds no Provider and could never rebuild one.
  await appendTurn(id, result.record);
  // A new floor is a large change; snapshot rather than replay it later.
  await saveSnapshot(id, result.state);
  const region = activeRegion(result.state.world);
  return {
    view: await viewOf(id, result.state, await transcriptOf(id)),
    error: null,
    arrived: region ? `${region.name} — ${region.biome}` : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Fighting                                                                    */
/* -------------------------------------------------------------------------- */

export type CombatStepView = {
  view: GameView;
  error: string | null;
  finished: boolean;
  /**
   * A finished fight's last lines. The view carries a log only while a fight is
   * open, so without this the lines that say how it ended — who fled, the dice a
   * word was rolled on — were built here and never shown.
   */
  closing?: string[];
};

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

  // A word is heard HERE, where a provider exists: the model answers, the engine
  // rolls, and the verdict is written into the action the log will keep.
  if (action.kind === 'parley') {
    const said = typeof action.say === 'string' ? action.say.slice(0, 300) : '';
    const rng = mulberry32(fight.state.world.seed + fight.state.world.turn * 7919 + (fight.state.combat?.log.length ?? 0));
    action = await hearParley(provider(), rng, fight.state, { ...action, say: said });
  }

  const step = takeCombatAction(fight.state, action);
  if (step.error) {
    return {
      view: await viewOf(id, fight.state, await transcriptOf(id), fight.log),
      error: step.error,
      finished: false,
    };
  }

  fight.state = step.state;
  fight.actions.push(action);
  fight.log = [...fight.log, ...notableEvents(step.events)];

  if (fightOpen(fight.state)) {
    fights.set(id, fight);
    return { view: await viewOf(id, fight.state, await transcriptOf(id), fight.log), error: null, finished: false };
  }

  // Over. Fold the consequences out, write the turn, and forget the encounter.
  const settled = settleFight(fight);
  const seq = await appendTurn(id, settled.record);
  await saveSnapshot(id, settled.state);
  fights.delete(id);

  const combat = fight.state.combat;
  // Beaten, not only dead: whoever broke is off the board.
  const down = Object.values(combat?.combatants ?? {}).filter((c) => c.side === 'foe' && c.dead).length
    + Object.keys(combat?.broken ?? {}).length;
  const tail = [
    ...fight.log,
    combat?.victor === 'party'
      ? `You are still standing. ${down} down.`
      : 'You do not get back up.',
  ];
  void seq;

  return { view: await viewOf(id, settled.state, await transcriptOf(id)), error: null, finished: true, closing: tail };
}

/** Whether a fight is waiting on the player, e.g. after a page reload. */
export const hasActiveFight = (id: string): boolean => fights.has(id);

/* -------------------------------------------------------------------------- */
/* The panels                                                                  */
/* -------------------------------------------------------------------------- */

const extent = (cells: readonly { x: number; y: number }[]) => ({
  w: cells.reduce((most, c) => Math.max(most, c.x + 1), 0),
  h: cells.reduce((most, c) => Math.max(most, c.y + 1), 0),
});

/** A container's board, flattened to what a browser can draw. */
function boardView(item: Item): GameView['inventory']['stacks'][number]['board'] {
  const board = boardOf(item);
  if (!board) return null;
  return { ...extent(board.cells), cells: board.cells.map((c) => [c.x, c.y] as [number, number]) };
}

/** What is laid out on it, in the squares it actually covers. */
function placedView(holding: Holding): GameView['inventory']['stacks'][number]['placed'] {
  return placementsIn(holding).map((p) => {
    const inside = (holding.contents?.held ?? []).find((h) => h.instance.id === p.id);
    return {
      id: p.id,
      name: inside?.item.name ?? p.id,
      cells: p.shape.cells.map((c) => [c.x + p.at.x, c.y + p.at.y] as [number, number]),
    };
  });
}

/** The pieces of an assembly, each with its own wear. */
function partsView(holding: Holding): GameView['inventory']['stacks'][number]['parts'] {
  return (holding.instance.parts ?? []).map((p) => ({
    id: p.item.id,
    name: partTypeOf(p.item.typeId)?.name ?? p.item.typeId,
    condition: p.item.condition / PRISTINE,
    fused: Boolean(p.item.fused),
  }));
}

/** What has gone into a thing, and what the next step would take. */
function improvementView(holding: Holding | undefined, rules: Ruleset) {
  if (!holding) {
    return {
      refine: null, rarity: null, enchants: [], canRefine: false, canEnchant: false,
      canEnhance: false, refineCost: 0, enchantCost: 0, enhanceCost: 0, enhanceResets: false,
      canRepair: false, repairCost: 0, repairCeiling: 1,
    };
  }

  const inst = holding.instance;
  const level = inst.refine ?? 0;
  const failing = weakestPart(inst);
  const ceiling = ceilingOf(failing, rules.gear.repairLoss);
  return {
    refine: level,
    rarity: inst.rarity ?? 'common',
    enchants: [...(inst.enchants ?? [])],
    canRefine: level < rules.gear.maxRefine,
    canEnchant: canEnchant(inst),
    canEnhance: nextRarity(inst.rarity) !== null,
    refineCost: refineCost(level),
    enchantCost: enchantCost(inst.enchants?.length ?? 0),
    enhanceCost: enhanceCost(inst.rarity),
    // What enhancing would throw away, so the trade can be shown rather than
    // discovered.
    enhanceResets: level > 0 || (inst.enchants?.length ?? 0) > 0,
    canRepair: failing.condition < ceiling,
    repairCost: repairCost(inst, holding.item.value, rules.gear.repairLoss),
    repairCeiling: ceiling / PRISTINE,
  };
}

function inventoryViewOf(state: PlayState): GameView['inventory'] {
  const inv = state.pc.inventory;
  const worn = new Set(Object.values(inv.equipped));

  /*
   * ONE LIST, of two different things.
   *
   * A stack is a kind of thing with a count; a holding is one specific object
   * and its id is that object's. The panel does not need to care which it is
   * looking at — it needs an id it can act on, and for a holding that has to be
   * the INSTANCE id, or equipping "an axe" could never mean the sharp one.
   */
  const line = (
    item: Item, id: string, count: number, condition: number,
    inside: string | null = null, holding?: Holding,
  ) => ({
    id,
    name: item.name,
    description: item.description,
    kind: item.kind,
    count,
    equipped: worn.has(id),
    slot: item.slot ?? null,
    usable: item.kind === 'consumable' && Boolean(item.effect),
    wearable: item.kind === 'equipment' && Boolean(item.slot),
    condition,
    inside,
    capacity: holding && isContainer(item) && item.capacity !== undefined ? item.capacity : null,
    space: holding && isContainer(item) && item.capacity !== undefined ? spaceIn(holding) : null,
    board: holding ? boardView(item) : null,
    placed: holding ? placedView(holding) : [],
    parts: holding ? partsView(holding) : [],
    ...improvementView(holding, rulesOf(state.world)),
    // A history is not advertised until it exists, and once read the button
    // goes rather than sitting there offering nothing.
    hasLore: Boolean(loreFor(item, state.world, state.sheet.language)),
    read: knowsLore(state.sheet, `lore_${item.id}`),
  });

  /** Everything held, at any depth, each knowing which bag it came out of. */
  const heldLines = (from: Inventory, inside: string | null): ReturnType<typeof line>[] =>
    from.held.flatMap((h) => [
      line(h.item, h.instance.id, 1, conditionOfInstance(h.instance) / PRISTINE, inside, h),
      ...(h.contents ? heldLines(h.contents, h.instance.id) : []),
    ]);

  return {
    stacks: [
      ...inv.stacks.map((stack) => line(stack.item, stack.item.id, stack.count, 1)),
      ...heldLines(inv, null),
    ],
    equipped: { ...inv.equipped } as Record<string, string>,
    workings: [...ENCHANT_NAMES],
    slots: rulesOf(state.world).gear.slots.map((slot) => {
      const holding = inv.equipped[slot.id] ? findHolding(inv, inv.equipped[slot.id]!) : null;
      return {
        id: slot.id,
        name: slot.name,
        itemId: holding?.instance.id ?? null,
        itemName: holding?.item.name ?? null,
        condition: holding ? conditionOfInstance(holding.instance) / PRISTINE : 1,
      };
    }),
  };
}

/**
 * The tree as the player may see it.
 *
 * Hidden nodes are omitted entirely rather than greyed out — a node you cannot
 * yet earn should not be a locked door you can count, it should be somewhere
 * the map does not go.
 */
function treeViewOf(state: PlayState): GameView['tree'] {
  const tree = treeFor(state);
  const ctx = contextOf(state);
  const allocation = allocationOf(state.sheet, tree);
  const visible = visibleNodes(tree, ctx);
  const shown = new Set(visible.map((n) => n.id));

  return {
    home: tree.home,
    paths: tree.paths,
    nodes: visible.map((node) => ({
      id: node.id,
      name: node.name,
      description: node.description,
      kind: node.kind,
      stat: node.stat,
      path: node.path,
      teaches: node.teaches ? `${node.teaches.name} — ${describeEffect(node.teaches)}` : null,
      grafted: node.grafted ? { kind: node.grafted.kind, name: node.grafted.name } : null,
      freeStanding: Boolean(node.freeStanding),
      requiresAll: node.requiresAll ?? [],
      x: node.x,
      y: node.y,
      // Edges to nodes that are not visible would draw lines into nothing.
      connections: node.connections.filter((c) => shown.has(c)),
      taken: allocation.taken.includes(node.id),
      // Structure only. Whether a point is AFFORDABLE is a separate question,
      // and conflating them made the whole tree look dead at level one instead
      // of showing the routes out of the centre.
      // Mirrors the three entry rules, so the drawing agrees with what the
      // engine will actually allow.
      reachable: !allocation.taken.includes(node.id) && entryOpen(node, allocation),
    })),
  };
}

export function traitsViewOf(state: PlayState): GameView['traits'] {
  const ctx = contextOf(state);
  const held = new Set(state.sheet.traits);

  /*
   * Only what this world asks of you, and only the goals.
   *
   * Two filters, for two different reasons. A trait from another world would
   * advertise an achievement this run does not contain — that is the subset.
   *
   * An UNEARNED EMERGENT trait is worse, and it is the whole reason the split
   * exists. "You have killed more things than you have spoken to" sitting in
   * the panel as something to work toward turns a recognition into a target,
   * and the aiming is precisely what the trait claims you did not do. So it
   * appears only once it is already true. Held ones stay, because being told
   * what you have become is the entire payoff.
   */
  return traitsFor(state.world.seed, traitOriginOf(state))
    .filter((trait) => held.has(trait.id) || !isEmergent(trait.id))
    .map((trait) => ({
    id: trait.id,
    name: trait.name,
    description: trait.description,
    held: held.has(trait.id),
    /*
     * The note, which nothing has ever read.
     *
     * `Trait.grants.note` is set by every authored, generated and emergent
     * trait and was consumed by nobody — so the twelve authored traits carry
     * lines strictly better than their own descriptions ("You have stopped
     * flinching first.", "Frightened people tell you things.") that no player
     * has ever seen.
     *
     * Shown only once EARNED, on purpose. A note says what you have become; as
     * an unearned goal it would read as a promise, and for an emergent trait
     * that would be the aiming the trait claims you did not do.
     */
    note: held.has(trait.id) ? trait.grants?.note ?? null : null,
    progress: progressOf(trait, ctx).map((p) => ({ label: p.label, have: p.have, need: p.need, met: p.met })),
  }));
}

/**
 * Signets, filtered twice.
 *
 * First by provability — anything this tower could never grant is discarded
 * before it can become a mystery with no answer — and then by what the player
 * has actually discovered.
 */
function signetsViewOf(state: PlayState): GameView['signets'] {
  const held = state.sheet.signets ?? [];
  const catalogue = signetsFor(state).kept;
  const world = { flags: state.world.flags, deepestFloor: state.world.deepestFloor };

  return visibleSignets(catalogue, held, contextOf(state), world).map((v) => ({
    id: v.signet.id,
    name: v.signet.name,
    description: v.signet.description,
    held: v.held,
    available: v.available,
    augments: v.signet.augments.id,
  }));
}

export type SheetActionView = { view: GameView; error: string | null; note: string | null };

/**
 * A panel action: spend a point, take a node, wear something, drink something.
 *
 * Appended to the log like any other event, so a reload replays it. No model
 * call — equipping a helmet is bookkeeping, not a story beat.
 */
export async function actOnSheet(id: string, action: SheetAction): Promise<SheetActionView | null> {
  await bootstrap();

  // A fight in progress is the live state; acting against the stored one would
  // silently discard the encounter.
  const fight = fights.get(id);
  if (fight) {
    return {
      view: await viewOf(id, fight.state, await transcriptOf(id), fight.log),
      error: 'not in the middle of a fight',
      note: null,
    };
  }

  const loaded = await loadSession(id);
  if (!loaded) return null;

  const result = applySheetAction(loaded.state, action);
  if (result.error) {
    return { view: await viewOf(id, loaded.state, await transcriptOf(id)), error: result.error, note: null };
  }

  const seq = await appendTurn(id, sheetRecord(action));
  if (shouldSnapshot(seq)) await saveSnapshot(id, result.state);

  return { view: await viewOf(id, result.state, await transcriptOf(id)), error: null, note: result.note };
}


/**
 * A skill's effect in a phrase, so the sidebar says what it actually does.
 *
 * One clause per PURPOSE, joined — which is how a two-effect skill like the old
 * `drain` finally reads as the two things it always was. Costs are reported
 * separately, as a number the player can weigh against a pool.
 */
function describeEffect(skill: ActiveSkill): string {
  return purposes(skill.effects).map(clauseOf).join(', ') || 'nothing on its own';
}

function clauseOf(e: Effect): string {
  const at = e.who === 'own' ? 'you' : e.who === 'everyone' ? 'everyone' : `a ${e.who}`;
  const area = e.shape.kind === 'burst' ? ` within ${e.shape.radius}` : '';
  const amount = magnitudeOf(e);

  switch (e.channel) {
    case 'hp':
      return e.sign === 'minus' ? `${amount} damage to ${at}${area}` : `heals ${at} ${amount}`;
    case 'stamina':
    case 'mana':
      return `${e.sign === 'minus' ? 'drains' : 'restores'} ${amount} ${e.channel} on ${at}`;
    case 'condition': {
      const held = e.duration.kind === 'rounds' ? ` for ${e.duration.rounds}` : '';
      return e.sign === 'minus' ? `leaves ${at} ${e.condition}${held}` : `clears ${e.condition} on ${at}`;
    }
    case 'stat':
      return `${e.sign === 'minus' ? '-' : '+'}${amount} on ${e.stat} checks`;
    case 'special':
      return `${e.verb}s ${at}`;
  }
}
