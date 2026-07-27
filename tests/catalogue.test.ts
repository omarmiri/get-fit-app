import { describe, expect, it } from 'vitest';

import { ALL_EXERCISES, getExercise, isTrendable } from '@/data/exercises';
import { DAY_KEYS, PLAN, PLAN_ORDER, getPlanDay, isDayKey } from '@/data/plan';

/**
 * Guards on the content itself.
 *
 * The plan and exercise catalogue are hand-edited data, and the roadmap calls
 * for a lot more of it. These checks catch the mistakes that editing invites —
 * a duplicated id, a day that lost its exercises, a typo in a rep target.
 */

describe('exercise catalogue', () => {
  it('has unique ids, so logged sets cannot be ambiguous', () => {
    const ids = ALL_EXERCISES.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses ids that are safe as persistence keys', () => {
    for (const exercise of ALL_EXERCISES) {
      expect(exercise.id).toMatch(/^[a-z][a-z0-9]*$/);
    }
  });

  it('gives every exercise all three cues', () => {
    for (const exercise of ALL_EXERCISES) {
      expect(exercise.cues.setup.length, exercise.id).toBeGreaterThan(0);
      expect(exercise.cues.execute.length, exercise.id).toBeGreaterThan(0);
      expect(exercise.cues.avoid.length, exercise.id).toBeGreaterThan(0);
    }
  });

  it('gives every exercise a sane set count, rep target and rest', () => {
    for (const exercise of ALL_EXERCISES) {
      expect(exercise.sets, exercise.id).toBeGreaterThan(0);
      expect(exercise.sets, exercise.id).toBeLessThanOrEqual(10);
      expect(exercise.defaultReps, exercise.id).toBeGreaterThan(0);
      expect(exercise.restSeconds, exercise.id).toBeGreaterThan(0);
      expect(exercise.repRange.length, exercise.id).toBeGreaterThan(0);
    }
  });

  it('marks timed movements as such rather than counting seconds as reps', () => {
    for (const exercise of ALL_EXERCISES) {
      const looksTimed = /sec/i.test(exercise.repRange);
      expect(exercise.repMetric === 'seconds', `${exercise.id} repMetric`).toBe(looksTimed);
    }
  });

  it('requires alt text whenever an exercise gains an image', () => {
    // No exercise has media yet; this guards the roadmap addition.
    for (const exercise of ALL_EXERCISES) {
      if (exercise.media?.image || exercise.media?.video) {
        expect(exercise.media.alt, `${exercise.id} media.alt`).toBeTruthy();
      }
    }
  });

  it('resolves known ids and returns undefined for retired ones', () => {
    expect(getExercise('legpress')?.name).toBe('Leg press');
    expect(getExercise('nope')).toBeUndefined();
  });

  it('excludes bodyweight and timed movements from trends', () => {
    const trendable = (id: string): boolean => {
      const exercise = getExercise(id);
      expect(exercise, id).toBeDefined();
      return exercise ? isTrendable(exercise) : false;
    };

    expect(trendable('legpress')).toBe(true);
    // A plank has no one-rep max; a carry is measured in seconds.
    expect(trendable('plank')).toBe(false);
    expect(trendable('farmercarry')).toBe(false);
    expect(trendable('birddog')).toBe(false);
  });
});

describe('plan', () => {
  it('covers all seven days', () => {
    expect(Object.keys(PLAN)).toHaveLength(7);
    for (const key of DAY_KEYS) expect(PLAN[key]).toBeDefined();
  });

  it('keys each day consistently with its own key field', () => {
    for (const key of DAY_KEYS) expect(PLAN[key].key).toBe(key);
  });

  it('orders DAY_KEYS to match Date#getDay', () => {
    // 2025-03-02 is a Sunday.
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(2025, 2, 2 + i);
      expect(DAY_KEYS[date.getDay()]).toBe(DAY_KEYS[i]);
    }
  });

  it('lists every day exactly once in the Monday-first display order', () => {
    expect([...PLAN_ORDER].sort()).toEqual([...DAY_KEYS].sort());
  });

  it('gives duration-based days both minutes and modalities', () => {
    for (const key of DAY_KEYS) {
      const day = PLAN[key];
      if (day.type === 'strength') continue;
      expect(day.minutes, `${key} minutes`).toBeGreaterThan(0);
      expect(day.modalityStations?.length, `${key} modality stations`).toBeGreaterThan(0);
    }
  });

  it('gives strength days exercises and no duration', () => {
    for (const key of DAY_KEYS) {
      const day = PLAN[key];
      if (day.type !== 'strength') continue;
      expect(day.exercises?.length, `${key} exercises`).toBeGreaterThan(0);
      expect(day.minutes, `${key} minutes`).toBeUndefined();
    }
  });

  it('excludes strength days from the aerobic-minutes goal', () => {
    for (const key of DAY_KEYS) {
      if (PLAN[key].type === 'strength') expect(PLAN[key].aerobic, key).toBe(false);
    }
  });

  it('only references exercises that exist in the catalogue', () => {
    for (const key of DAY_KEYS) {
      for (const exercise of PLAN[key].exercises ?? []) {
        expect(getExercise(exercise.id), `${key}/${exercise.id}`).toBeDefined();
      }
    }
  });

  it('recognises real day keys and rejects others', () => {
    expect(isDayKey('mon')).toBe(true);
    expect(isDayKey('funday')).toBe(false);
    expect(isDayKey(null)).toBe(false);
    expect(getPlanDay('mon')?.label).toBe('Cardio + Core');
    expect(getPlanDay('funday')).toBeUndefined();
  });
});
