import type { Abilities } from '../combat/types.ts';
import type { CharacterClass } from '../character/classes.ts';

/**
 * Session Zero as a GM interview rather than a form.
 *
 * The STAGES are fixed in code, which is what makes this deterministic and
 * testable; only the phrasing of each question and the interpretation of the
 * answers need a model. Same principle as everywhere else in this codebase:
 * structure in code, flavour from the model.
 *
 * Both creation paths the game promises are covered by one flow — write a prose
 * summary and let it generate the sheet, or set abilities and background by
 * hand in `draft`, or any mixture of the two.
 */

export const STAGES = ['world', 'character', 'drive', 'review'] as const;
export type Stage = (typeof STAGES)[number];

export type Language = 'th' | 'en';

/** Anything the player pinned down by hand. Generation must not overwrite these. */
export type CharacterDraft = {
  name?: string;
  baseAbilities?: Abilities;
  backgroundName?: string;
  traits?: string[];
  /** The class picked on the creation page. Its mechanics outrank the model's. */
  classId?: string;
  /**
   * The resolved class, when it came from this world's generated roster.
   *
   * Carried rather than looked up, because a generated class is in no global
   * list — see `classSpec` on the sheet. The id alone would resolve to nothing.
   */
  classSpec?: CharacterClass;
};

export type Interview = {
  language: Language;
  stage: Stage;
  answers: Partial<Record<Stage, string>>;
  draft: CharacterDraft;
  done: boolean;
};

export type InterviewResult = { interview: Interview; error: string | null };

const QUESTIONS: Record<Stage, Record<Language, string>> = {
  world: {
    en: 'What kind of world is the tower standing in? Anything from a dead city to a green kingdom — a sentence is plenty.',
    th: 'หอคอยนี้ตั้งอยู่ในโลกแบบไหน จะเป็นเมืองร้าง อาณาจักรเขียวชอุ่ม หรืออะไรก็ได้ บอกสั้น ๆ ก็พอ',
  },
  character: {
    en: 'Who are you in it? Describe yourself however you like, or give me the bare facts and I will fill in the rest.',
    th: 'คุณเป็นใครในโลกนี้ จะเล่าแบบไหนก็ได้ หรือบอกแค่ข้อมูลคร่าว ๆ แล้วผมจะเติมส่วนที่เหลือให้',
  },
  drive: {
    en: 'What do you want badly enough to climb for — and what are you leaving behind at the bottom?',
    th: 'อะไรที่คุณอยากได้มากพอจะปีนหอคอยนี้ และคุณกำลังทิ้งอะไรไว้ข้างล่าง',
  },
  review: {
    en: 'Here is your character and the world. Tell me anything you want changed, or say you are ready.',
    th: 'นี่คือตัวละครและโลกของคุณ อยากแก้ตรงไหนบอกได้ หรือบอกว่าพร้อมแล้ว',
  },
};

export function questionFor(stage: Stage, language: Language): string {
  return QUESTIONS[stage][language];
}

export function startInterview(language: Language = 'en'): Interview {
  return { language, stage: 'world', answers: {}, draft: {}, done: false };
}

export const stageIndex = (stage: Stage): number => STAGES.indexOf(stage);

/** Every stage before `review` must have a non-empty answer. */
export function isComplete(interview: Interview): boolean {
  return STAGES.filter((s) => s !== 'review').every((s) => (interview.answers[s] ?? '').trim().length > 0);
}

export function recordAnswer(interview: Interview, text: string): InterviewResult {
  if (interview.done) return { interview, error: 'the interview is already finished' };

  const answer = text.trim();
  if (!answer) return { interview, error: `the ${interview.stage} question needs an answer` };

  const answers = { ...interview.answers, [interview.stage]: answer };
  const next = STAGES[stageIndex(interview.stage) + 1];

  return {
    interview: {
      ...interview,
      answers,
      stage: next ?? interview.stage,
      // Answering the review question is what ends the interview.
      done: interview.stage === 'review',
    },
    error: null,
  };
}

export function back(interview: Interview): InterviewResult {
  const previous = STAGES[stageIndex(interview.stage) - 1];
  if (!previous) return { interview, error: 'already at the first question' };
  return { interview: { ...interview, stage: previous, done: false }, error: null };
}

/** Pin down part of the character by hand. Later generation must respect this. */
export function setDraft(interview: Interview, patch: CharacterDraft): Interview {
  return { ...interview, draft: { ...interview.draft, ...patch } };
}

/**
 * The interview rendered for a generator: what was asked and what was said, in
 * order, so the model sees the conversation rather than a bag of fields.
 */
export function transcript(interview: Interview): string {
  return STAGES.filter((stage) => interview.answers[stage])
    .map((stage) => `Q (${stage}): ${questionFor(stage, interview.language)}\nA: ${interview.answers[stage]}`)
    .join('\n\n');
}
