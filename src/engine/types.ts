/**
 * Core data model.
 *
 * Two things live here and they must not be confused:
 *   - The BIBLE is generated once, validated, then FROZEN. It never changes during
 *     play, which is what lets it sit in the cached prompt prefix.
 *   - The STATE is a fold over the event log. It is the only thing that moves.
 */

export type NpcId = string;
export type ClueId = string;
export type BeatId = string;

export const STATS = ['observation', 'nerve', 'charm', 'cunning', 'composure'] as const;
export type StatName = (typeof STATS)[number];
export type Stats = Record<StatName, number>;

/** Trust runs -3..+4; the bands drive Thai register (see llm/register). */
export const TRUST_MIN = -3;
export const TRUST_MAX = 4;

/**
 * A gate is the condition on obtaining a clue.
 *
 * Gates are deliberately a small closed language rather than free text, because
 * two different things must evaluate them:
 *   - isOpen()      — is this satisfied RIGHT NOW, during play
 *   - isSatisfiable() — could this EVER be satisfied, during worldgen validation
 * The second is what makes the solvability walk possible at all.
 */
export type Gate =
  | { kind: 'open' }
  | { kind: 'trust'; npc: NpcId; min: number }
  | { kind: 'hasClue'; clue: ClueId }
  | { kind: 'flag'; flag: string }
  | { kind: 'allOf'; of: Gate[] }
  | { kind: 'anyOf'; of: Gate[] };

/** Who or what holds a clue. Scene-held clues are physical evidence. */
export type Holder =
  | { kind: 'npc'; id: NpcId }
  | { kind: 'scene'; location: string };

export type Clue = {
  id: ClueId;
  /** Shown to the player once learned. In the target language. */
  fact: string;
  heldBy: Holder;
  gate: Gate;
};

export type NpcVoice = {
  selfPronoun: string;
  /** trust band -> how they address the player. Keys are band floors. */
  addressBands: Record<string, string>;
  /** trust band -> sentence-ending particle. */
  particleBands: Record<string, string>;
  tics: string[];
};

/** Social standing relative to the PC. Drives what the PC's own pronoun costs. */
export const STATUSES = ['superior', 'peer', 'inferior'] as const;
export type Status = (typeof STATUSES)[number];

export type Npc = {
  id: NpcId;
  name: string;
  role: string;
  status: Status;
  personality: { traits: string[]; wants: string; fears: string; secret: string };
  voice: NpcVoice;
  stats: Stats;
  knowledge: {
    knows: ClueId[];
    /** Clues they know but will misrepresent. Must be a subset of knows. */
    liesAbout: ClueId[];
  };
  relationships: { toPC: number; toOthers: Record<NpcId, number> };
  /** What they do when the player is not watching. */
  agenda: string[];
  /** Clock ticks per agenda step. */
  agendaPace: number;
};

export type PC = {
  name: string;
  background: string;
  traits: string[];
  stats: Stats;
  voice: { selfPronoun: string; underStress: string };
};

export type Beat = {
  id: BeatId;
  /** Derived from the clue graph: the milestone clue that closes this beat. */
  exitWhen: ClueId;
  /** Non-advancing turns tolerated before a pressure move fires. */
  leash: number;
  pressure: string[];
};

export type Bible = {
  meta: {
    id: string;
    language: 'th' | 'en';
    premise: string;
    setting: string;
    era: string;
    tone: string;
  };
  /** NEVER sent to the Writer. */
  truth: { culprit: NpcId; method: string; motive: string; timeline: string[] };
  pc: PC;
  cast: Npc[];
  clues: Clue[];
  solutionRequires: ClueId[];
  beats: Beat[];
  startLocation: string;
};

export type NpcState = {
  trust: number;
  mood: string;
  present: boolean;
};

export type GameState = {
  turn: number;
  beat: BeatId;
  /** Counts DOWN within a beat; refilled from beat.leash on advance. */
  clock: number;
  /** Monotonic total clock ever spent. Agenda progress is a pure function of it. */
  clockSpent: number;
  location: string;
  pc: {
    stats: Stats;
    resources: { time: number; suspicion: number; cash: number };
    selfPronoun: string;
  };
  npcs: Record<NpcId, NpcState>;
  /** What the PLAYER knows. Never conflate with bible.truth. */
  playerFacts: ClueId[];
  flags: Record<string, boolean>;
  /** How many pressure items have fired per beat. */
  pressureFired: Record<BeatId, number>;
  ended: null | { reason: string };
};

export const CLASSES = ['ADVANCES', 'NEUTRAL', 'DIVERGES', 'IMPOSSIBLE'] as const;
export type Classification = (typeof CLASSES)[number];

export const TIERS = ['miss', 'partial', 'hit'] as const;
export type Tier = (typeof TIERS)[number];

export type RollResult = {
  stat: StatName;
  vs: { npc: NpcId; stat: StatName } | null;
  dice: [number, number];
  modifier: number;
  total: number;
  tier: Tier;
};

/** What the Director is allowed to change. Everything else is engine-owned. */
export type StateDelta = {
  learnClues?: ClueId[];
  /** Per-NPC trust CHANGES, not absolutes. */
  trust?: Record<NpcId, number>;
  mood?: Record<NpcId, string>;
  flags?: Record<string, boolean>;
  suspicion?: number;
  cash?: number;
  clockSpend?: number;
  location?: string;
  present?: Record<NpcId, boolean>;
};

export type Mode = 'conversation' | 'investigation';

export type TurnEvent = {
  kind: 'turn';
  input: string;
  mode: Mode;
  classification: Classification;
  /** Dice are RECORDED, never re-rolled, so the fold stays deterministic. */
  roll: RollResult | null;
  delta: StateDelta;
  prose: string;
};

export type GameEvent = { kind: 'start' } | TurnEvent;
