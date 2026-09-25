import { describe, expect, it } from 'vitest';

import type { DayKey, UserPlan, UserPlanDay } from '@/types';
import { aerobicMinutes, topUpCardio } from '@/domain/cardioTopUp';
import { validatePlan } from '@/domain/planValidation';

/** A week from a list of day shapes, Sunday first. */
function week(shapes: readonly ('rest' | 'strength' | number)[]): UserPlan {
  const keys: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const days = keys.map((dayKey, i): UserPlanDay => {
    const shape = shapes[i] ?? 'rest';
    if (shape === 'rest') {
      return { dayKey, label: 'Rest', type: 'rest', sub: '', note: '', outline: ['Rest'], aerobic: false };
    }
    if (shape === 'strength') {
      return {
        dayKey,
        label: 'Strength',
        type: 'strength',
        sub: '',
        note: '',
        outline: ['Warm up', 'Lift'],
        aerobic: false,
        exerciseIds: ['legpress', 'chestpress'],
      };
    }
    return {
      dayKey,
      label: 'Cardio',
      type: 'duration',
      sub: '',
      note: '',
      outline: ['Warm up', 'Ride'],
      aerobic: true,
      minutes: shape,
      modalityStations: ['uprightbike'],
    };
  });
  return { id: 'p', summary: '', days, generatedAt: 1, model: 'test' };
}

describe('topUpCardio', () => {
  it('leaves a plan that already reaches the target alone', () => {
    expect(topUpCardio(week([50, 'strength', 50, 'strength', 50]))).toBeNull();
  });

  it('lengthens existing cardio days first', () => {
    const topUp = topUpCardio(week([30, 'strength', 30, 'strength', 30, 'rest', 'rest']));

    expect(aerobicMinutes(topUp?.plan ?? week([]))).toBeGreaterThanOrEqual(150);
    // 60 of 150 missing, and three cardio days with 30 minutes of room each.
    expect(topUp?.plan.days.filter((day) => day.type === 'strength')).toHaveLength(2);
    expect(topUp?.changes.every((change) => change.includes('→'))).toBe(true);
  });

  it('adds cardio after the lifts when a strength-heavy week has no room elsewhere', () => {
    // The week that prompted this: four strength days and one short cardio day.
    const topUp = topUpCardio(week(['strength', 'strength', 'strength', 'strength', 45, 'rest', 'rest']));
    const plan = topUp?.plan ?? week([]);

    expect(aerobicMinutes(plan)).toBeGreaterThanOrEqual(150);
    const mixed = plan.days.filter((day) => day.type === 'mixed');
    expect(mixed.length).toBeGreaterThan(0);
    for (const day of mixed) {
      expect(day.exerciseIds?.length).toBeGreaterThan(0);
      expect(day.minutes).toBeLessThanOrEqual(20);
      expect(day.outline.at(-1)).toContain('easy cardio');
    }
  });

  it('produces a plan the validator accepts without the cardio warning', () => {
    const topUp = topUpCardio(week(['strength', 'rest', 'strength', 'rest', 'strength', 'rest', 'rest']));
    const validation = validatePlan(topUp?.plan ?? week([]));

    expect(validation.ok).toBe(true);
    expect(validation.issues.some((issue) => issue.message.includes('aerobic minutes'))).toBe(false);
  });

  it('turns rest days into easy walks only when nothing else has room', () => {
    const topUp = topUpCardio(week(['strength', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest']));
    const walks = topUp?.plan.days.filter((day) => day.type === 'duration') ?? [];

    expect(walks.length).toBeGreaterThan(0);
    for (const walk of walks) expect(walk.minutes).toBeLessThanOrEqual(30);
  });
});

describe('topUpCardio block sizes', () => {
  it('never adds a walk or finisher too short to be worth starting', () => {
    const shapes = [
      ['strength', 'strength', 'strength', 'strength', 45, 'rest', 'rest'],
      ['strength', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'],
      [140, 'strength', 'rest', 'strength', 'rest', 'rest', 'rest'],
    ] as const;

    for (const shape of shapes) {
      const before = week(shape);
      const plan = topUpCardio(before)?.plan ?? before;
      plan.days.forEach((day, i) => {
        const was = before.days[i];
        if (was?.type === 'rest' && day.type === 'duration') expect(day.minutes).toBeGreaterThanOrEqual(20);
        if (was?.type === 'strength' && day.type === 'mixed') expect(day.minutes).toBeGreaterThanOrEqual(10);
      });
    }
  });
});

describe('a topped-up strength week', () => {
  it('still counts its lifting days as strength days', () => {
    const before = week(['strength', 'strength', 'strength', 'strength', 45, 'rest', 'rest']);
    const after = topUpCardio(before)?.plan ?? before;

    expect(validatePlan(after).strengthDays).toBe(validatePlan(before).strengthDays);
  });
});
