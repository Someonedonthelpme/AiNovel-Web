import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWords, dateOf, nameCalendar, startOf, TICKS_PER_DAY, timeLine } from './calendar.ts';
import { playState } from '../play/fixtures.ts';
import { FakeProvider } from '../llm/provider.ts';
import { eraOf } from './strata.ts';
import { TIMES } from './types.ts';
import { groundFloor } from './fixtures.ts';
import { runDirector } from '../llm/director.ts';
import type { Stratum, World } from './types.ts';

/*
 * 6b stage 7.1e-ii: THE CALENDAR. A fixed shape the engine owns — 24-hour days,
 * 7-day weeks, 30-day months, 12 months, 4 seasons — in the world's own words,
 * starting on the world's own date.
 */

const calendarReply = () => ({
  reckoning: 'the Adar reckoning',
  days: ['Ash', 'Brine', 'Coal', 'Dusk', 'Ember', 'Frost', 'Gale'],
  months: ['Thaw', 'Seed', 'Bloom', 'Sun', 'Hay', 'Fire', 'Reap', 'Mist', 'Rot', 'Hush', 'Bone', 'Dark'],
  seasons: ['Wake', 'Blaze', 'Fall', 'Sleep'],
});

test('a clock reading is a date', () => {
  const start = { year: 328, day: 32 };
  const w = { ...playState().world, clock: 0 };
  // Day 32 of year 328 is the 118,111th day since the reckoning began, and 118,111
  // is a multiple of 7, so it is the first weekday (weekday 0).
  assert.deepEqual(dateOf(w, start), { year: 328, month: 2, day: 2, weekday: 0, season: 0, hour: 8, minute: 0 });
  assert.equal(dateOf({ ...w, clock: TICKS_PER_DAY * 329 }, start).year, 329, 'the year turns');
  assert.deepEqual(
    { hour: dateOf({ ...w, clock: 15 }, start).hour, minute: dateOf({ ...w, clock: 15 }, start).minute },
    { hour: 10, minute: 30 },
    'fifteen ticks after eight is half past ten',
  );
});

test('each world starts on its own date, from the seed', () => {
  assert.deepEqual(startOf(7), startOf(7));
  assert.notDeepEqual(startOf(7), startOf(8));
  const s = startOf(7);
  assert.ok(s.day >= 1 && s.day <= 360 && s.year >= 1, JSON.stringify(s));
});

test("the calendar's words are the world's, with fallbacks until named", async () => {
  const words = calendarWords(playState().world);
  assert.equal(words.days.length, 7);
  assert.equal(words.months.length, 12);
  assert.equal(words.seasons.length, 4);

  const named = await nameCalendar(new FakeProvider({ structured: [calendarReply()] }), 'a drowned kingdom', 'en');
  assert.equal(named.reckoning, 'the Adar reckoning');
  assert.equal(named.days.length, 7);
  assert.equal(calendarWords({ ...playState().world, calendar: named }).months[0], 'Thaw');
});

test('a reply with the wrong number of words is refused, and the fallbacks stand', async () => {
  const bad = await nameCalendar(new FakeProvider({ structured: [{ ...calendarReply(), months: ['one'] }] }), '', 'en');
  assert.equal(bad.months.length, 12);
  assert.notEqual(bad.reckoning, 'the Adar reckoning', 'a half-right answer is not taken at all');
});

/* -------------------------------------------------------------------------- */
/* ERAS (DESIGN 6c, *Stratum knobs*): each floor of an era stratum its own     */
/* year. Whole years only, so the hour, the season and the night stay the      */
/* world's, and every reader of those needs no floor.                          */
/* -------------------------------------------------------------------------- */

const eraStrata = (): Record<string, Stratum> => ({
  tower: { id: 'tower', name: 'the tower', kind: 'dynamic', from: 0 },
  eras: { id: 'eras', name: 'the Eras', kind: 'dynamic', parent: 'tower', from: 21, to: 30, laws: { time: 'era' } },
});
const eraWorld = (over: Partial<World> = {}): World => ({ ...playState().world, strata: eraStrata(), ...over });
const floors = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const offsets = (w: World) => floors(21, 30).map((f) => eraOf(w, f));
const omit = <T extends object>(o: T, ...keys: (keyof T)[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k as keyof T)));

test('the time law is closed and defaults to the world clock', () => {
  assert.deepEqual(TIMES, ['world', 'era']);
  assert.equal(eraOf(playState().world, 5), 0, 'no strata, no law, no offset');
});

test('each floor of an era stratum is its own year: past, ascending toward the present', () => {
  const w = eraWorld();
  const offs = offsets(w);
  assert.ok(offs.every((o) => o < 0), `every era is in the past: ${offs}`);
  assert.ok(offs.every((o, i) => i === 0 || o > offs[i - 1]), `higher floor, later era: ${offs}`);
  assert.deepEqual([eraOf(w, 20), eraOf(w, 31)], [0, 0], 'outside the stratum, the world clock');
});

test('an era stratum with no top floor is refused, not read as the world clock', () => {
  const open = { ...eraStrata().eras, to: undefined };
  const w = eraWorld({ strata: { ...eraStrata(), eras: open } });
  assert.throws(() => eraOf(w, 22), /era stratum "eras" has no top floor/);
  assert.equal(eraOf(w, 5), 0, 'a floor outside it still reads the world clock');
});

test('eras are dealt from the seed, never stored', () => {
  const w = eraWorld();
  assert.deepEqual(offsets(w), offsets(structuredClone(w)));
  assert.notDeepEqual(offsets(w), offsets({ ...w, seed: w.seed + 1 }));
});

test('an era moves only the year', () => {
  const w = eraWorld({ clock: 777 });
  const start = { year: 328, day: 32 };
  const now = dateOf(w, start);
  const then = dateOf(w, start, 22);
  assert.equal(then.year, now.year + eraOf(w, 22));
  // Not the weekday: a 360-day year is three days off a whole number of weeks.
  assert.deepEqual(omit(then, 'year', 'weekday'), omit(now, 'year', 'weekday'));
});

test('an era before the reckoning began reads as such, not as a year below one', () => {
  // Worlds start in years 1..999, so a band of past eras can reach behind year 1.
  const seed = floors(1, 5000).find((s) => startOf(s).year + eraOf(eraWorld({ seed: s }), 21) < 1);
  assert.ok(seed, 'some seed puts floor 21 before the reckoning');
  const w = eraWorld({ seed, clock: 0 });
  const year = startOf(seed).year + eraOf(w, 21);
  // Year 0 is the year before year 1, so year −40 is 41 years before it.
  const line = timeLine(w, 21);
  assert.ok(line.includes(`${1 - year} years before ${calendarWords(w).reckoning}`), line);
  assert.doesNotMatch(line, /year -?\d+ of/);
});

test('the Director is told the era year on an era floor, the world year elsewhere', async () => {
  const sentOnFloor = async (floor: number) => {
    const state = playState({ strata: eraStrata(), regions: { 'floor-0': { ...groundFloor(), floor, exit: null } } });
    const p = new FakeProvider({ structured: [] });
    await runDirector(p, state, 'look around', 'exploration', []).catch(() => {});
    return { sent: p.allSentText(), world: state.world };
  };
  // Compared as whole time lines: an era year below one reads as "N years
  // before", so a `year N of` pattern cannot match it.
  const era = await sentOnFloor(22);
  assert.notEqual(eraOf(era.world, 22), 0, 'floor 22 is an era floor');
  assert.ok(era.sent.includes(`Time: ${timeLine(era.world, 22)}`), 'the era year');
  assert.ok(!era.sent.includes(`Time: ${timeLine(era.world)}`), 'not the world year');
  const ground = await sentOnFloor(0);
  assert.ok(ground.sent.includes(`Time: ${timeLine(ground.world)}`), 'the world year');
});
