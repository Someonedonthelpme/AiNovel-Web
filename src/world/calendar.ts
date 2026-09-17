import { mulberry32 } from '../engine/roll.ts';
import type { Provider } from '../llm/provider.ts';

/**
 * Time, in the world's own measure (DESIGN 6b stage 7.1e).
 *
 * One tick of the world clock is TEN MINUTES: fine enough for a walk across town
 * (10–30 minutes), coarse enough that a day is 144 ticks. Everything that takes
 * time — travel, rest, recovery, a grudge fading — is counted in these.
 */
export const MINUTES_PER_TICK = 10;
export const TICKS_PER_HOUR = 60 / MINUTES_PER_TICK;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

/**
 * THE CALENDAR'S SHAPE is the engine's, fixed: 7-day weeks, 30-day months, 12
 * months, 4 seasons of 3 months each — a 360-day year. Only the WORDS are the
 * world's. A shape that varied per world would make every reader ask the world
 * how long a month is; a fixed one keeps replays and tests plain.
 */
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const MONTHS_PER_SEASON = 3;
/** Every world's clock starts at this hour of its first day. */
export const START_HOUR = 8;

export type WorldDate = {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..30 */
  day: number;
  /** 0..6, counted from the first day of the reckoning. */
  weekday: number;
  /** 0..3: 0 is the season the year opens in. */
  season: number;
  hour: number;
  minute: number;
};

export type WorldStart = { year: number; day: number };

/**
 * The date a world begins on, dealt from its seed — "day 32 of year 328". Never
 * stored, so a world made before the calendar has one too.
 */
export function startOf(seed: number): WorldStart {
  const rng = mulberry32((seed ^ 0xca1e) >>> 0);
  return { year: 1 + Math.floor(rng() * 999), day: 1 + Math.floor(rng() * DAYS_PER_YEAR) };
}

/** What the clock reads as a date. `clock` is ticks since the world's start. */
export function dateOf(world: { seed: number; turn: number; clock?: number }, start: WorldStart = startOf(world.seed)): WorldDate {
  const clock = world.clock ?? world.turn;
  const origin = (start.year * DAYS_PER_YEAR + (start.day - 1)) * TICKS_PER_DAY + START_HOUR * TICKS_PER_HOUR;
  const now = origin + clock;
  const days = Math.floor(now / TICKS_PER_DAY);
  const ofYear = days % DAYS_PER_YEAR;
  const month = Math.floor(ofYear / DAYS_PER_MONTH) + 1;
  const minutes = (now % TICKS_PER_DAY) * MINUTES_PER_TICK;
  return {
    year: Math.floor(days / DAYS_PER_YEAR),
    month,
    day: (ofYear % DAYS_PER_MONTH) + 1,
    weekday: days % DAYS_PER_WEEK,
    season: Math.floor((month - 1) / MONTHS_PER_SEASON),
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  };
}

/** What a world calls its reckoning, its days, its months and its seasons. */
export type CalendarWords = { reckoning: string; days: string[]; months: string[]; seasons: string[] };

const FALLBACK: Record<'th' | 'en', CalendarWords> = {
  en: {
    reckoning: 'the tower reckoning',
    days: ['First-day', 'Second-day', 'Third-day', 'Fourth-day', 'Fifth-day', 'Sixth-day', 'Rest-day'],
    months: ['First Month', 'Second Month', 'Third Month', 'Fourth Month', 'Fifth Month', 'Sixth Month',
      'Seventh Month', 'Eighth Month', 'Ninth Month', 'Tenth Month', 'Eleventh Month', 'Last Month'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
  },
  th: {
    reckoning: 'ศักราชหอคอย',
    days: ['วันที่หนึ่ง', 'วันที่สอง', 'วันที่สาม', 'วันที่สี่', 'วันที่ห้า', 'วันที่หก', 'วันพัก'],
    months: ['เดือนหนึ่ง', 'เดือนสอง', 'เดือนสาม', 'เดือนสี่', 'เดือนห้า', 'เดือนหก',
      'เดือนเจ็ด', 'เดือนแปด', 'เดือนเก้า', 'เดือนสิบ', 'เดือนสิบเอ็ด', 'เดือนสุดท้าย'],
    seasons: ['ฤดูผลิ', 'ฤดูร้อน', 'ฤดูใบไม้ร่วง', 'ฤดูหนาว'],
  },
};

/** This world's calendar words, or the fallbacks until it has been named. */
export const calendarWords = (world: { language: 'th' | 'en'; calendar?: CalendarWords }): CalendarWords =>
  world.calendar ?? FALLBACK[world.language];

const str = { type: 'string' } as const;
const words = (n: number) => ({ type: 'array', items: str, minItems: n, maxItems: n }) as const;

export const CALENDAR_NAMING_SCHEMA = {
  type: 'object',
  properties: {
    reckoning: str,
    days: words(DAYS_PER_WEEK),
    months: words(MONTHS_PER_YEAR),
    seasons: words(4),
  },
  required: ['reckoning', 'days', 'months', 'seasons'],
  additionalProperties: false,
} as const;

/**
 * Name the calendar in the world's own words — words only; the shape is fixed.
 *
 * Like every naming call, the game does without it: an unavailable model, or an
 * answer with the wrong number of words anywhere, leaves the fallbacks. A
 * half-right answer is not taken at all, because a calendar with eleven named
 * months reads as a bug, not as a world.
 */
export async function nameCalendar(provider: Provider, world: string, language: 'th' | 'en'): Promise<CalendarWords> {
  const fallback = FALLBACK[language];
  try {
    const answer = await provider.structured<Partial<CalendarWords>>({
      schemaName: 'calendar_naming',
      schema: CALENDAR_NAMING_SCHEMA,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            `You name a world's calendar, writing in ${language === 'th' ? 'Thai' : 'English'}.`,
            'The shape is fixed and you do not change it: a name for the reckoning (the era years are',
            `counted in), ${DAYS_PER_WEEK} day names, ${MONTHS_PER_YEAR} month names in order, and 4 season names`,
            'in order, starting with the season the year opens in. One word or a short phrase each.',
          ].join('\n'),
        },
        { role: 'user', content: `The world: ${world.trim() || 'a tower, and not much else is known yet'}` },
      ],
    });
    return validCalendar(answer) ?? fallback;
  } catch {
    // Deliberately swallowed, like every other naming call.
    return fallback;
  }
}

function validCalendar(answer: Partial<CalendarWords> | null | undefined): CalendarWords | null {
  const clean = (list: unknown, n: number): string[] | null => {
    if (!Array.isArray(list) || list.length !== n) return null;
    const out = list.map((w) => (typeof w === 'string' ? w.trim() : ''));
    return out.every(Boolean) ? out : null;
  };
  const reckoning = typeof answer?.reckoning === 'string' ? answer.reckoning.trim() : '';
  const days = clean(answer?.days, DAYS_PER_WEEK);
  const months = clean(answer?.months, MONTHS_PER_YEAR);
  const seasons = clean(answer?.seasons, 4);
  return reckoning && days && months && seasons ? { reckoning, days, months, seasons } : null;
}
