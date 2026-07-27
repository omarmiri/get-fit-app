import type { AppState, IsoDate, LoggedSet, Session, WeightUnit } from '@/types';
import { GOALS, getPlanDay } from '@/data/plan';
import { ALL_EXERCISES, isTrendable } from '@/data/exercises';
import { addDays, parseIsoDate, startOfWeek, toIsoDate } from '@/domain/dates';
import { bestOneRepMax } from '@/domain/metrics';
import { type PerformanceBlock, toPerformanceBlocks } from '@/domain/progression';

/**
 * Derived reads over `AppState`.
 *
 * Pure functions of state, kept out of both the store and the views so the
 * numbers on screen can be tested without a DOM.
 */

/** Progress against the weekly targets. */
export interface WeekStats {
  readonly aerobicMinutes: number;
  readonly strengthSessions: number;
  readonly minutesGoal: number;
  readonly strengthGoal: number;
}

export function weekStats(state: AppState, now: Date = new Date()): WeekStats {
  const weekBegan = startOfWeek(now);
  let aerobicMinutes = 0;
  let strengthSessions = 0;

  for (const session of state.sessions) {
    if (parseIsoDate(session.date) < weekBegan) continue;
    const day = getPlanDay(session.dayKey);
    if (!day) continue;
    if (day.aerobic && session.minutes) aerobicMinutes += session.minutes;
    if (day.type === 'strength') strengthSessions += 1;
  }

  return {
    aerobicMinutes,
    strengthSessions,
    minutesGoal: GOALS.minutes,
    strengthGoal: GOALS.strength,
  };
}

/** Dates with at least one finished session, for the week strip's markers. */
export function completedDates(state: AppState): ReadonlySet<IsoDate> {
  return new Set(state.sessions.map((session) => session.date));
}

/** The finished session logged today for a given plan day, if any. */
export function todaysSession(state: AppState, dayKey: string, today: IsoDate): Session | undefined {
  return state.sessions.find((s) => s.date === today && s.dayKey === dayKey);
}

/** The most recent previous performance of one exercise. */
export interface PreviousPerformance {
  readonly date: IsoDate;
  readonly sets: readonly LoggedSet[];
}

/**
 * Find the last time an exercise was performed, searching newest first.
 *
 * Used to prefill the steppers, which is the single biggest time-saver in the
 * logging flow — most sessions repeat the previous load.
 */
export function lastPerformance(state: AppState, exerciseId: string): PreviousPerformance | null {
  for (let i = state.sessions.length - 1; i >= 0; i -= 1) {
    const session = state.sessions[i];
    if (!session) continue;
    const sets = session.sets.filter((set) => set.exerciseId === exerciseId);
    if (sets.length > 0) return { date: session.date, sets };
  }
  return null;
}

/** One bar in the weekly aerobic chart. */
export interface WeekBucket {
  readonly weekStart: Date;
  readonly minutes: number;
  readonly metGoal: boolean;
}

/** Aerobic minutes bucketed by week, oldest first, ending with the current week. */
export function minutesByWeek(state: AppState, weeks = 8, now: Date = new Date()): WeekBucket[] {
  const currentWeekStart = startOfWeek(now);
  const buckets: WeekBucket[] = [];

  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const from = addDays(currentWeekStart, -offset * 7);
    const to = addDays(from, 7);
    let minutes = 0;

    for (const session of state.sessions) {
      const date = parseIsoDate(session.date);
      if (date < from || date >= to) continue;
      const day = getPlanDay(session.dayKey);
      if (day?.aerobic && session.minutes) minutes += session.minutes;
    }

    buckets.push({ weekStart: from, minutes, metGoal: minutes >= GOALS.minutes });
  }

  return buckets;
}

/** One point on an exercise's strength trend. */
export interface TrendPoint {
  readonly date: IsoDate;
  /** Estimated one-rep max, in the unit requested. */
  readonly value: number;
}

/** Estimated one-rep max over time for one exercise, oldest first. */
export function trendPoints(state: AppState, exerciseId: string, unit: WeightUnit): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const session of state.sessions) {
    const best = bestOneRepMax(session, exerciseId, unit);
    if (best !== null) points.push({ date: session.date, value: best });
  }
  return points;
}

/**
 * Exercises that have enough logged history to chart.
 *
 * Bodyweight and timed movements are excluded — see `isTrendable`.
 */
export function trendableExercises(state: AppState): typeof ALL_EXERCISES {
  const logged = new Set<string>();
  for (const session of state.sessions) {
    for (const set of session.sets) {
      if (set.weight > 0) logged.add(set.exerciseId);
    }
  }
  return ALL_EXERCISES.filter((exercise) => isTrendable(exercise) && logged.has(exercise.id));
}

/** Consecutive days ending today (or yesterday) with a logged session. */
export function currentStreak(state: AppState, now: Date = new Date()): number {
  const dates = completedDates(state);
  if (dates.size === 0) return 0;

  // Starting from yesterday keeps a streak alive during a rest day that has not
  // been logged yet, rather than resetting it at midnight.
  let cursor = new Date(now);
  if (!dates.has(toIsoDate(cursor))) cursor = addDays(cursor, -1);

  let streak = 0;
  while (dates.has(toIsoDate(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * A movement's history at one station, oldest first, for the progression engine.
 *
 * Scoped to the station because loads are not comparable across machines: a
 * hack squat and a leg press train the same thing but with entirely different
 * numbers, and progressing one from the other's history would be nonsense.
 *
 * A `stationId` of `undefined` matches sets logged before stations existed, so
 * old history still drives recommendations for the default station.
 */
export function performanceHistory(
  state: AppState,
  exerciseId: string,
  stationId: string | undefined,
): PerformanceBlock[] {
  const matched: { date: IsoDate; set: LoggedSet }[] = [];

  for (const session of state.sessions) {
    for (const set of session.sets) {
      if (set.exerciseId !== exerciseId) continue;
      if (set.weight <= 0) continue;
      // Sets from before stations were tracked count toward whichever station
      // is currently selected, rather than being stranded.
      if (set.stationId !== undefined && set.stationId !== stationId) continue;
      matched.push({ date: session.date, set });
    }
  }

  return toPerformanceBlocks(matched);
}
