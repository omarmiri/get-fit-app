import { describe, expect, it } from 'vitest';

import type { UserPlanDay, UserPlan } from '@/types';
import { DAY_KEYS } from '@/data/plan';
import { errorsOf, validatePlan } from '@/domain/planValidation';

/**
 * The gate between a non-deterministic model and the app.
 *
 * These tests exist because "the plan looked fine" is not a check. Anything the
 * model returns that the app cannot actually render has to be caught here
 * rather than half-rendered in a gym.
 */

function day(overrides: Partial<UserPlanDay> & Pick<UserPlanDay, 'dayKey'>): UserPlanDay {
  return {
    label: 'Session',
    type: 'duration',
    sub: 'Some cardio',
    note: 'Take it easy.',
    outline: ['Warm up', 'Work', 'Stretch'],
    aerobic: true,
    minutes: 40,
    modalityStations: ['treadmill'],
    ...overrides,
  };
}

/**
 * A strength day, built explicitly rather than by overriding the cardio
 * fixture — `exactOptionalPropertyTypes` means an absent field and a field set
 * to `undefined` are different things, and these days genuinely have neither
 * minutes nor stations.
 */
function strengthDay(dayKey: UserPlanDay['dayKey']): UserPlanDay {
  return {
    dayKey,
    label: 'Strength',
    type: 'strength',
    sub: 'Full body',
    note: 'Rest 60 to 90 seconds between sets.',
    outline: ['Warm up', 'Work through the list', 'Stretch'],
    aerobic: false,
    exerciseIds: ['legpress', 'chestpress', 'seatedrow'],
    exerciseFormat: 'sets',
  };
}

/** A week that passes cleanly: 5 cardio days, 2 spaced strength days. */
function healthyPlan(overrides: Partial<UserPlan> = {}): UserPlan {
  const strength = strengthDay;

  return {
    id: 'p1',
    summary: 'Balanced week.',
    generatedAt: 0,
    model: 'test',
    days: [
      day({ dayKey: 'sun', minutes: 30 }),
      day({ dayKey: 'mon', minutes: 45 }),
      strength('tue'),
      day({ dayKey: 'wed', minutes: 35 }),
      day({ dayKey: 'thu', minutes: 40 }),
      strength('fri'),
      day({ dayKey: 'sat', minutes: 50 }),
    ],
    ...overrides,
  };
}

describe('validatePlan — structure', () => {
  it('accepts a complete, guideline-meeting week', () => {
    const result = validatePlan(healthyPlan());

    expect(result.ok).toBe(true);
    expect(errorsOf(result)).toHaveLength(0);
  });

  it('totals aerobic minutes and strength days', () => {
    const result = validatePlan(healthyPlan());

    expect(result.weeklyAerobicMinutes).toBe(200);
    expect(result.strengthDays).toBe(2);
  });

  it('rejects a week missing a day', () => {
    const plan = healthyPlan();
    const result = validatePlan({ ...plan, days: plan.days.slice(0, 6) });

    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((i) => i.message.includes('Missing day'))).toBe(true);
  });

  it('rejects a duplicated day', () => {
    const plan = healthyPlan();
    const first = plan.days[0];
    if (!first) throw new Error('fixture');
    const result = validatePlan({ ...plan, days: [...plan.days, first] });

    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((i) => i.message.includes('Duplicate'))).toBe(true);
  });
});

describe('validatePlan — catalogue references', () => {
  it('rejects an invented exercise', () => {
    // The failure this whole gate exists for. An id outside the catalogue has
    // no cues, no station mapping, no starting weight and no progression, and
    // would orphan anything logged against it.
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) =>
        d.dayKey === 'tue' ? { ...d, exerciseIds: ['legpress', 'banded-lateral-walk'] } : d,
      ),
    });

    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((i) => i.message.includes('banded-lateral-walk'))).toBe(true);
  });

  it('rejects an invented station', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'mon' ? { ...d, modalityStations: ['hydrofoil'] } : d)),
    });

    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((i) => i.message.includes('hydrofoil'))).toBe(true);
  });

  it('warns rather than blocks when equipment is marked absent from the club', () => {
    const result = validatePlan(healthyPlan(), { missingStationIds: ['treadmill'] });

    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.message.includes('Treadmill'))).toBe(true);
  });
});

describe('validatePlan — a week that is not a week', () => {
  it('rejects a plan where every day is empty', () => {
    /*
     * Real output from Perplexity, given a prompt that told it to ask about
     * equipment first. It expressed the question *as a plan*: seven rest days
     * labelled "Awaiting Equipment". That parsed, validated with only two soft
     * warnings, and would have been adopted as a training week.
     *
     * Falling short of the aerobic target is a judgement call and warns.
     * Prescribing nothing whatsoever is a different kind of thing.
     */
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => ({
        dayKey: d.dayKey,
        label: 'Awaiting Equipment',
        type: 'rest' as const,
        sub: '',
        note: '',
        outline: ['Rest'],
        aerobic: false,
      })),
    });

    expect(result.ok).toBe(false);
    expect(errorsOf(result).some((i) => i.message.includes('Every day in this plan is empty'))).toBe(true);
  });

  it('accepts a week with rest days as long as something is prescribed', () => {
    // The check must not punish a legitimately light week — only an empty one.
    // Rest days are built rather than overridden: `exactOptionalPropertyTypes`
    // makes an absent `minutes` and one set to `undefined` different things.
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) =>
        d.dayKey === 'mon'
          ? d
          : {
              dayKey: d.dayKey,
              label: 'Rest',
              type: 'rest' as const,
              sub: '',
              note: '',
              outline: ['Rest'],
              aerobic: false,
            },
      ),
    });

    expect(errorsOf(result).some((i) => i.message.includes('Every day in this plan is empty'))).toBe(false);
  });
});

describe('validatePlan — day shape', () => {
  it('rejects a strength day with no exercises', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'tue' ? { ...d, exerciseIds: [] } : d)),
    });

    expect(errorsOf(result).some((i) => i.message.includes('no exercises'))).toBe(true);
  });

  it('rejects a timed day that says neither where nor how', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'mon' ? { ...d, modalityStations: [] } : d)),
    });

    expect(errorsOf(result).some((i) => i.message.includes('does not say what to do'))).toBe(true);
  });

  it('accepts a timed day described in prose instead of by station id', () => {
    /*
     * The escape hatch that makes plans from other gyms usable. An LLM writing
     * for a gym this app has no vocabulary for must be able to say what the
     * cardio is in words, rather than having the whole week rejected for
     * naming a machine that is not on a list.
     */
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) =>
        d.dayKey === 'mon'
          ? { ...d, modalityStations: [], modality: 'The assault bike in the corner by the door' }
          : d,
      ),
    });

    expect(result.ok).toBe(true);
    expect(errorsOf(result).some((i) => i.message.includes('does not say what to do'))).toBe(false);
  });

  it('rejects an implausible duration', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'mon' ? { ...d, minutes: 600 } : d)),
    });

    expect(errorsOf(result).some((i) => i.message.includes('implausible'))).toBe(true);
  });

  it('rejects a day with no outline, since the session would be unreadable', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'mon' ? { ...d, outline: [] } : d)),
    });

    expect(errorsOf(result).some((i) => i.message.includes('outline'))).toBe(true);
  });
});

describe('validatePlan — programming guidance', () => {
  it('warns when the week falls short of the aerobic target', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.aerobic ? { ...d, minutes: 10 } : d)),
    });

    // A warning, not an error — a deliberately light week is the user's call.
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.message.includes('aerobic minutes'))).toBe(true);
  });

  it('warns when there are too few strength days', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      days: plan.days.map((d) => (d.dayKey === 'fri' ? day({ dayKey: 'fri', minutes: 40 }) : d)),
    });

    expect(result.issues.some((i) => i.message.includes('strength'))).toBe(true);
  });

  it('warns about back-to-back strength days', () => {
    const plan = healthyPlan();
    const result = validatePlan({
      ...plan,
      // Wednesday becomes strength, so it sits directly before Thursday's.
      days: plan.days.map((d) => (d.dayKey === 'wed' ? strengthDay('wed') : d)),
    });

    expect(result.issues.some((i) => i.message.includes('back to back'))).toBe(true);
  });

  it('does not flag strength days that are properly spaced', () => {
    const result = validatePlan(healthyPlan());
    expect(result.issues.some((i) => i.message.includes('back to back'))).toBe(false);
  });
});

describe('validatePlan — resilience', () => {
  it('never throws on a badly shaped plan', () => {
    expect(() =>
      validatePlan({ id: 'x', summary: '', days: [], generatedAt: 0, model: 'test' }),
    ).not.toThrow();
  });

  it('reports every missing day rather than stopping at the first', () => {
    const result = validatePlan({ id: 'x', summary: '', days: [], generatedAt: 0, model: 'test' });
    expect(errorsOf(result).filter((i) => i.message.includes('Missing day'))).toHaveLength(DAY_KEYS.length);
  });
});
