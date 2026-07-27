import { describe, expect, it } from 'vitest';

import type { AppState, DayKey, LoggedSet, Session } from '@/types';
import { defaultState } from '@/state/schema';
import {
  completedDates,
  currentStreak,
  lastPerformance,
  minutesByWeek,
  trendPoints,
  trendableExercises,
  weekStats,
} from '@/state/selectors';

/** Wednesday, 5 March 2025. The week containing it starts Sunday the 2nd. */
const NOW = new Date(2025, 2, 5, 12, 0);

function session(date: string, dayKey: DayKey, extra: Partial<Session> = {}): Session {
  return {
    id: `s-${date}-${dayKey}`,
    date,
    dayKey,
    sets: [],
    minutes: null,
    modality: null,
    effort: null,
    startedAt: 0,
    ...extra,
  };
}

function set(exerciseId: string, weight: number, reps: number): LoggedSet {
  return { exerciseId, weight, unit: 'lb', reps, loggedAt: 0 };
}

function stateWith(sessions: Session[]): AppState {
  return { ...defaultState(), sessions };
}

describe('weekStats', () => {
  it('counts only aerobic days toward the minutes goal', () => {
    const state = stateWith([
      session('2025-03-03', 'mon', { minutes: 45 }),
      session('2025-03-04', 'tue', { minutes: 60 }), // strength — excluded
      session('2025-03-05', 'wed', { minutes: 35 }),
    ]);

    expect(weekStats(state, NOW).aerobicMinutes).toBe(80);
  });

  it('counts strength sessions separately', () => {
    const state = stateWith([session('2025-03-04', 'tue'), session('2025-03-05', 'fri')]);
    expect(weekStats(state, NOW).strengthSessions).toBe(2);
  });

  it('ignores sessions from previous weeks', () => {
    const state = stateWith([
      session('2025-02-28', 'mon', { minutes: 45 }), // previous week
      session('2025-03-03', 'mon', { minutes: 30 }),
    ]);

    expect(weekStats(state, NOW).aerobicMinutes).toBe(30);
  });

  it('includes the first day of the week', () => {
    const state = stateWith([session('2025-03-02', 'sun', { minutes: 25 })]);
    expect(weekStats(state, NOW).aerobicMinutes).toBe(25);
  });

  it('ignores sessions whose plan day no longer exists', () => {
    const state = stateWith([{ ...session('2025-03-03', 'mon', { minutes: 45 }), dayKey: 'xxx' as DayKey }]);
    expect(weekStats(state, NOW).aerobicMinutes).toBe(0);
  });
});

describe('lastPerformance', () => {
  it('finds the most recent session containing the exercise', () => {
    const state = stateWith([
      session('2025-03-01', 'tue', { sets: [set('legpress', 100, 10)] }),
      session('2025-03-04', 'tue', { sets: [set('legpress', 120, 8)] }),
      session('2025-03-05', 'wed', { sets: [set('plank', 0, 30)] }),
    ]);

    const previous = lastPerformance(state, 'legpress');
    expect(previous?.date).toBe('2025-03-04');
    expect(previous?.sets[0]?.weight).toBe(120);
  });

  it('returns every set from that session, not just one', () => {
    const state = stateWith([
      session('2025-03-04', 'tue', { sets: [set('legpress', 100, 10), set('legpress', 110, 8)] }),
    ]);

    expect(lastPerformance(state, 'legpress')?.sets).toHaveLength(2);
  });

  it('returns null for an exercise never performed', () => {
    expect(lastPerformance(stateWith([]), 'legpress')).toBeNull();
  });
});

describe('minutesByWeek', () => {
  it('returns one bucket per week, oldest first', () => {
    const buckets = minutesByWeek(stateWith([]), 8, NOW);
    expect(buckets).toHaveLength(8);
    expect(buckets[0]?.weekStart.getTime()).toBeLessThan(buckets[7]?.weekStart.getTime() ?? 0);
  });

  it('places sessions in the right week', () => {
    const state = stateWith([
      session('2025-03-03', 'mon', { minutes: 45 }),
      session('2025-02-24', 'mon', { minutes: 30 }),
    ]);

    const buckets = minutesByWeek(state, 8, NOW);
    expect(buckets.at(-1)?.minutes).toBe(45);
    expect(buckets.at(-2)?.minutes).toBe(30);
  });

  it('flags weeks that reached the goal', () => {
    const state = stateWith([
      session('2025-03-02', 'sun', { minutes: 100 }),
      session('2025-03-03', 'mon', { minutes: 60 }),
    ]);

    expect(minutesByWeek(state, 8, NOW).at(-1)?.metGoal).toBe(true);
  });
});

describe('trendPoints', () => {
  it('produces one point per session with a qualifying set', () => {
    const state = stateWith([
      session('2025-03-01', 'tue', { sets: [set('legpress', 100, 5)] }),
      session('2025-03-04', 'tue', { sets: [set('legpress', 110, 5)] }),
      session('2025-03-05', 'wed', { sets: [set('plank', 0, 30)] }),
    ]);

    const points = trendPoints(state, 'legpress', 'lb');
    expect(points).toHaveLength(2);
    expect(points[0]?.value).toBeLessThan(points[1]?.value ?? 0);
  });

  it('is empty for timed and bodyweight movements', () => {
    const state = stateWith([session('2025-03-05', 'mon', { sets: [set('plank', 20, 30)] })]);
    expect(trendPoints(state, 'plank', 'lb')).toHaveLength(0);
  });
});

describe('trendableExercises', () => {
  it('offers only loaded, rep-counted movements that have history', () => {
    const state = stateWith([
      session('2025-03-04', 'tue', {
        sets: [set('legpress', 100, 10), set('plank', 0, 30), set('birddog', 0, 10)],
      }),
    ]);

    expect(trendableExercises(state).map((e) => e.id)).toEqual(['legpress']);
  });

  it('excludes exercises only ever logged at zero weight', () => {
    const state = stateWith([session('2025-03-04', 'tue', { sets: [set('legpress', 0, 10)] })]);
    expect(trendableExercises(state)).toHaveLength(0);
  });
});

describe('completedDates', () => {
  it('collapses several sessions on one date to a single entry', () => {
    const state = stateWith([session('2025-03-04', 'tue'), session('2025-03-04', 'mon')]);
    expect(completedDates(state).size).toBe(1);
  });
});

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    const state = stateWith([
      session('2025-03-03', 'mon'),
      session('2025-03-04', 'tue'),
      session('2025-03-05', 'wed'),
    ]);

    expect(currentStreak(state, NOW)).toBe(3);
  });

  it('survives a day that has not been logged yet', () => {
    // Nothing logged today; yesterday and the day before were.
    const state = stateWith([session('2025-03-03', 'mon'), session('2025-03-04', 'tue')]);
    expect(currentStreak(state, NOW)).toBe(2);
  });

  it('breaks on a gap', () => {
    const state = stateWith([session('2025-03-01', 'sat'), session('2025-03-05', 'wed')]);
    expect(currentStreak(state, NOW)).toBe(1);
  });

  it('is zero with no sessions', () => {
    expect(currentStreak(stateWith([]), NOW)).toBe(0);
  });
});
