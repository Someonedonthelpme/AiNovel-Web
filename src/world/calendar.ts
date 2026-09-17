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
