import type { AppState, DayKey, Exercise, IsoDate, LoggedSet, PlanDay, Session, WeightUnit } from '@/types';
import { GOALS, PLAN, getPlanDay } from '@/data/plan';
import { isTrendable } from '@/data/exercises';
import { catalogueFor, exerciseSourceOf } from '@/data/catalogue';
import { addDays, parseIsoDate, startOfWeek, toIsoDate } from '@/domain/dates';
import { bestOneRepMax, percentChange, sessionVolume } from '@/domain/metrics';
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

export type ActivePlan = Readonly<Record<DayKey, PlanDay>>;

export function weekStats(state: AppState, now: Date = new Date(), plan: ActivePlan = PLAN): WeekStats {
  const weekBegan = startOfWeek(now);
  let aerobicMinutes = 0;
  let strengthSessions = 0;

  for (const session of state.sessions) {
    if (parseIsoDate(session.date) < weekBegan) continue;
    const day = plan[session.dayKey] ?? getPlanDay(session.dayKey);
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
  /** The week in progress, which is not yet comparable with the finished ones. */
  readonly isCurrent: boolean;
}

/** Aerobic minutes bucketed by week, oldest first, ending with the current week. */
export function minutesByWeek(
  state: AppState,
  weeks = 8,
  now: Date = new Date(),
  plan: ActivePlan = PLAN,
): WeekBucket[] {
  const currentWeekStart = startOfWeek(now);
  const buckets: WeekBucket[] = [];

  for (let offset = weeks - 1; offset >= 0; offset -= 1) {
    const from = addDays(currentWeekStart, -offset * 7);
    const to = addDays(from, 7);
    let minutes = 0;

    for (const session of state.sessions) {
      const date = parseIsoDate(session.date);
      if (date < from || date >= to) continue;
      const day = plan[session.dayKey] ?? getPlanDay(session.dayKey);
      if (day?.aerobic && session.minutes) minutes += session.minutes;
    }

    buckets.push({
      weekStart: from,
      minutes,
      metGoal: minutes >= GOALS.minutes,
      isCurrent: offset === 0,
    });
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
    // `state` is itself a valid exercise source, so a movement defined by the
    // plan or retained in the archive charts like any built-in one.
    const best = bestOneRepMax(session, exerciseId, unit, exerciseSourceOf(state));
    if (best !== null) points.push({ date: session.date, value: best });
  }
  return points;
}

/**
 * Exercises that have enough logged history to chart.
 *
 * Bodyweight and timed movements are excluded — see `isTrendable`.
 *
 * Drawn from the full catalogue rather than the built-in one, so a movement an
 * imported plan defined appears in the trend picker on the same terms as
 * anything the app shipped. The point of logging a custom movement is being
 * able to see whether it is going anywhere.
 */
export function trendableExercises(state: AppState): readonly Exercise[] {
  const logged = new Set<string>();
  for (const session of state.sessions) {
    for (const set of session.sets) {
      if (set.weight > 0) logged.add(set.exerciseId);
    }
  }
  return catalogueFor(exerciseSourceOf(state)).filter(
    (exercise) => isTrendable(exercise) && logged.has(exercise.id),
  );
}

/** How one movement is going, as a single row. */
export interface MovementSummary {
  readonly id: string;
  readonly name: string;
  /** Latest estimated one-rep max, in the unit requested. */
  readonly latest: number;
  /** Percent change from the first logged session to the latest. */
  readonly change: number | null;
  /** Sessions since this movement last set a new best. */
  readonly flatSessions: number;
  /** Whether the latest estimate beats where it was roughly a month ago. */
  readonly improvedThisMonth: boolean;
}

/** Sessions with no new best before a movement counts as stalled. */
const FLAT_AFTER = 3;

/**
 * Every trendable movement, sorted by how much it has moved.
 *
 * The tab used to answer "am I getting stronger" one movement at a time,
 * behind a native select: twelve movements meant twelve taps, so nobody did
 * it, and the honest summary of the screen was "here is one line about leg
 * press, then thirty-five rows of deleted-by-accident risk".
 *
 * Answering it for all of them at once is what lets the flat and deloading
 * movements surface themselves instead of waiting to be found — which is the
 * only reason to look at this screen at all.
 */
export function movementSummaries(state: AppState, unit: WeightUnit): MovementSummary[] {
  const summaries: MovementSummary[] = [];

  for (const exercise of trendableExercises(state)) {
    const points = trendPoints(state, exercise.id, unit);
    const latest = points.at(-1);
    const first = points[0];
    if (!latest || !first) continue;

    summaries.push({
      id: exercise.id,
      name: exercise.name,
      latest: latest.value,
      change: percentChange(first.value, latest.value),
      flatSessions: flatSessions(points),
      improvedThisMonth: latest.value > monthAgoValue(points),
    });
  }

  // Biggest movers first, in either direction: a movement that has gone
  // backwards is at least as worth seeing as one that has gone forwards.
  return summaries.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
}

/** Trailing sessions that failed to beat the best before them. */
function flatSessions(points: readonly TrendPoint[]): number {
  let best = -Infinity;
  let lastBestIndex = -1;

  points.forEach((point, index) => {
    if (point.value > best) {
      best = point.value;
      lastBestIndex = index;
    }
  });

  return points.length - 1 - lastBestIndex;
}

/** The best estimate from a month or more ago, or the first one there is. */
function monthAgoValue(points: readonly TrendPoint[]): number {
  const cutoff = toIsoDate(addDays(new Date(), -30));
  const older = points.filter((point) => point.date <= cutoff);
  const pool = older.length > 0 ? older : points.slice(0, 1);
  return Math.max(...pool.map((point) => point.value));
}

/** A one-line verdict on the whole list, which is the tab for most visits. */
export function describeProgress(summaries: readonly MovementSummary[]): string[] {
  if (summaries.length === 0) return [];

  const improved = summaries.filter((entry) => entry.improvedThisMonth).length;
  const flat = summaries.filter((entry) => entry.flatSessions >= FLAT_AFTER).length;

  const lines = [
    `${improved} of ${summaries.length} movement${summaries.length === 1 ? '' : 's'} ${improved === 1 ? 'is' : 'are'} heavier than a month ago.`,
  ];

  if (flat > 0) {
    lines.push(`${flat} ${flat === 1 ? 'has' : 'have'} not moved in ${FLAT_AFTER} sessions.`);
  }

  return lines;
}

/** Whether a movement has stalled long enough to say so on its row. */
export function isStalled(summary: MovementSummary): boolean {
  return summary.flatSessions >= FLAT_AFTER;
}

/** Sessions grouped into weeks, newest week first, with each week's totals. */
export interface WeekGroup {
  readonly weekStart: Date;
  readonly sessions: readonly Session[];
  readonly minutes: number;
  readonly volume: number;
}

/**
 * The session log, collapsed by week.
 *
 * Three and a half screens of rows, newest first, with nothing to group them
 * was not a log anyone read — it was a list to scroll past. A week header
 * carries the totals that actually trend, and the sessions sit inside it.
 */
export function sessionsByWeek(state: AppState, unit: WeightUnit): WeekGroup[] {
  const source = exerciseSourceOf(state);
  const groups = new Map<number, { weekStart: Date; sessions: Session[] }>();

  for (const session of state.sessions) {
    const weekStart = startOfWeek(parseIsoDate(session.date));
    const key = weekStart.getTime();
    const group = groups.get(key) ?? { weekStart, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
    .map((group) => ({
      weekStart: group.weekStart,
      // Newest first inside the week too, matching the order of the weeks.
      sessions: [...group.sessions].sort((a, b) => b.date.localeCompare(a.date)),
      minutes: group.sessions.reduce((sum, session) => sum + (session.minutes ?? 0), 0),
      volume: group.sessions.reduce((sum, session) => sum + sessionVolume(session.sets, unit, source), 0),
    }));
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
