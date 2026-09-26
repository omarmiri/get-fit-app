import { describe, expect, it } from 'vitest';

import { goalStarterPlan, hasGoalStarter } from '@/data/goalPlans';
import { resolvePlan } from '@/data/activePlan';
import { DAY_KEYS } from '@/data/plan';
import { MAIN_GOALS } from '@/domain/gymProfile';
import { errorsOf, validatePlan } from '@/domain/planValidation';

/**
 * The ready-made week for each goal.
 *
 * Built in, so it has to clear the same gate as a plan a model wrote — a
 * typo in an exercise id here would ship a day with a gap in it.
 */
describe('goal starter plans', () => {
  const goals = MAIN_GOALS.map((goal) => goal.id).filter(hasGoalStarter);

  it('covers every goal but general fitness and something else', () => {
    expect(goals).toEqual(['routine', 'strength', 'cardio']);
  });

  it.each(goals)('%s validates with no errors and resolves every day', (goal) => {
    const plan = goalStarterPlan(goal, 0);
    expect(errorsOf(validatePlan(plan))).toEqual([]);

    const resolved = resolvePlan(plan);
    for (const key of DAY_KEYS)
      expect(resolved[key].label).toBe(plan.days.find((d) => d.dayKey === key)?.label);
  });

  it('weights each week toward its goal', () => {
    const strength = validatePlan(goalStarterPlan('strength', 0));
    const cardio = validatePlan(goalStarterPlan('cardio', 0));
    expect(strength.strengthDays).toBe(3);
    expect(cardio.weeklyAerobicMinutes).toBeGreaterThanOrEqual(150);
  });
});
