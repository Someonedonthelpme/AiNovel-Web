import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWords, dateOf, nameCalendar, startOf, TICKS_PER_DAY } from './calendar.ts';
import { playState } from '../play/fixtures.ts';
import { FakeProvider } from '../llm/provider.ts';

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
