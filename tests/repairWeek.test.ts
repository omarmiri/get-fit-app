import { describe, expect, it } from 'vitest';

import type { DayKey, UserPlanDay } from '@/types';
import { parsePortablePlan, repairWeek } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';

function days(keys: readonly DayKey[]): UserPlanDay[] {
  return keys.map((dayKey, i) => ({
    dayKey,
    label: `Day ${i + 1}`,
    type: 'rest',
    sub: '',
    note: '',
    outline: ['Rest'],
    aerobic: false,
  }));
}

describe('repairWeek', () => {
  it('relabels the duplicate that sits where the missing day belongs', () => {
    const { days: fixed, corrections } = repairWeek(days(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sun']));

    expect(fixed.map((day) => day.dayKey)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    // The record that moved is the seventh, keeping its own content.
    expect(fixed[6]?.label).toBe('Day 7');
    expect(corrections[0]).toMatch(/Sunday was listed twice and Saturday was missing/);
  });

  it('works for a week written Monday first', () => {
    const { days: fixed } = repairWeek(days(['mon', 'tue', 'wed', 'wed', 'fri', 'sat', 'sun']));

    expect(fixed.map((day) => day.dayKey)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('drops an eighth day that repeats the first', () => {
    const { days: fixed, corrections } = repairWeek(
      days(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    );

    expect(fixed.map((day) => day.dayKey)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(corrections).toHaveLength(1);
  });

  it('leaves a week it cannot read confidently for the validator to refuse', () => {
    const messy = days(['sun', 'sun', 'sun', 'wed', 'thu', 'fri', 'sat']);
    const { days: same, corrections } = repairWeek(messy);

    expect(same.map((day) => day.dayKey)).toEqual(messy.map((day) => day.dayKey));
    expect(corrections).toEqual([]);
  });

  it('does not touch a correct week', () => {
    const { corrections } = repairWeek(days(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']));

    expect(corrections).toEqual([]);
  });
});

describe('a plan with Sunday twice, end to end', () => {
  it('is repaired, validates, and says what changed', () => {
    const week = [
      'rf1|Test',
      'sun|rest|l=Rest|o=Rest;Walk',
      'mon|dur|l=Walk|o=Warm up;Walk|m=50|d=treadmill',
      'tue|str|l=Strength|o=Warm up;Lift|e=backsquat',
      'wed|dur|l=Walk|o=Warm up;Walk|m=50|d=treadmill',
      'thu|str|l=Strength|o=Warm up;Lift|e=benchpress',
      'fri|dur|l=Walk|o=Warm up;Walk|m=50|d=treadmill',
      'sun|rest|l=Rest|o=Rest;Stretch',
    ].join('~');

    const parsed = parsePortablePlan(week);

    expect(parsed.corrections).toHaveLength(1);
    expect(parsed.plan && validatePlan(parsed.plan).ok).toBe(true);
  });
});
