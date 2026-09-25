import { describe, expect, it } from 'vitest';

import type { Exercise, UserPlan } from '@/types';
import { resolveExercise, withSavedMovements } from '@/data/catalogue';
import { expandCompactPlan } from '@/domain/compactPlan';
import { incompleteMovement, parsePortablePlan } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';
import { buildLlmsTxt } from '@/spec/planSpec';
import { defaultState, parseState } from '@/state/schema';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { fingerprint, mergeStates } from '@/state/merge';

/**
 * Movements an LLM invents: accepted only when complete, and kept per user so
 * a later plan can reuse them by id.
 */

const SLED = {
  id: 'tire-flip',
  name: 'Tire flip',
  summary: 'Drive a loaded sled across the turf with your arms locked.',
  equipment: 'push sled and plates',
  sets: 4,
  repMin: 20,
  repMax: 30,
  repMetric: 'seconds',
  loaded: true,
  cues: {
    setup: 'Hands high on the posts, body at 45 degrees.',
    execute: 'Short fast steps through the balls of the feet.',
    avoid: 'Standing upright, which turns it into a walk.',
  },
};

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A seven-day plan whose Tuesday uses `ids`. */
function planUsing(ids: string[], exercises: unknown[] = []): Record<string, unknown> {
  return {
    kind: 'rackfile.plan',
    formatVersion: 1,
    exercises,
    days: DAYS.map((dayKey) =>
      dayKey === 'tue'
        ? { dayKey, type: 'strength', label: 'Strength', outline: ['Warm up', 'Lift'], exerciseIds: ids }
        : { dayKey, type: 'rest', label: 'Rest', outline: ['Rest', 'Walk'] },
    ),
  };
}

describe('incompleteMovement', () => {
  it('accepts a fully described movement', () => {
    expect(incompleteMovement(SLED)).toBeNull();
  });

  it('names every missing field at once, so one round of fixes is enough', () => {
    const { cues: _cues, sets: _sets, equipment: _equipment, ...thin } = SLED;
    const problem = incompleteMovement(thin);

    expect(problem).toContain('Tire flip');
    for (const field of ['sets', 'equipment', 'cues.setup', 'cues.execute', 'cues.avoid']) {
      expect(problem).toContain(field);
    }
  });

  it('takes a known station in place of written equipment', () => {
    const { equipment: _equipment, ...rest } = SLED;
    expect(incompleteMovement({ ...rest, stationId: 'turfarea' })).toBeNull();
  });

  it('requires loaded to be said, not assumed', () => {
    const { loaded: _loaded, ...rest } = SLED;
    expect(incompleteMovement(rest)).toContain('loaded');
  });
});

describe('parsePortablePlan with new movements', () => {
  it('reports an incomplete movement without refusing to read the plan', () => {
    const { cues: _cues, ...thin } = SLED;
    const parsed = parsePortablePlan(planUsing(['x:tire-flip'], [thin]));

    expect(parsed.plan).not.toBeNull();
    expect(parsed.incomplete).toHaveLength(1);
  });

  it('accepts a complete one', () => {
    expect(parsePortablePlan(planUsing(['x:tire-flip'], [SLED])).incomplete).toEqual([]);
  });

  it('keeps a reference to a saved movement the plan does not define', () => {
    const parsed = parsePortablePlan(planUsing(['legpress', 'x:tire-flip']));
    const tuesday = parsed.plan?.days.find((day) => day.dayKey === 'tue');

    expect(tuesday?.exerciseIds).toEqual(['legpress', 'x:tire-flip']);
  });
});

describe('the compact format', () => {
  const week = (movement: string): string =>
    `rf1|Test~tue|str|l=Strength|o=Warm up;Lift|e=x:tire-flip~${movement}~sun|rest|l=Rest|o=Rest;Walk`;

  it('carries cues in cs, ce and ca', () => {
    const raw = expandCompactPlan(
      week('x|Tire flip|d=Push a sled|q=sled|s=4|r=20-30s|w=90lb|cs=Lean in|ce=Drive|ca=Standing up'),
    );
    expect(parsePortablePlan(raw).incomplete).toEqual([]);
  });

  it('refuses a new movement with no cues and no like=', () => {
    const raw = expandCompactPlan(week('x|Tire flip|d=Push a sled|q=sled|s=4|r=20-30s|w=90lb'));
    expect(parsePortablePlan(raw).incomplete[0]).toContain('cues.setup');
  });

  it('lets like= supply the cues', () => {
    const raw = expandCompactPlan(week('x|Tire flip|like=legpress|d=Push a sled|q=sled|s=4|r=20-30s|w=90lb'));
    expect(parsePortablePlan(raw).incomplete).toEqual([]);
  });
});

describe('the user’s movement library', () => {
  const plan = (id: string, exercises: Exercise[]): UserPlan => ({
    id,
    summary: id,
    days: [
      {
        dayKey: 'tue',
        label: 'Strength',
        type: 'strength',
        sub: '',
        note: '',
        outline: ['Lift'],
        aerobic: false,
        exerciseIds: exercises.map((exercise) => exercise.id),
      },
    ],
    ...(exercises.length > 0 ? { exercises } : {}),
    generatedAt: 1,
    model: 'test',
  });

  const sled = (): Exercise => {
    const parsed = parsePortablePlan(planUsing(['x:tire-flip'], [SLED])).plan;
    const exercise = parsed?.exercises?.[0];
    if (!exercise) throw new Error('fixture did not parse');
    return exercise;
  };

  it('keeps a plan’s movements when the plan is adopted', () => {
    const store = new AppStore({ initialState: defaultState(), store: createMemoryStore(), saveDelayMs: 0 });
    store.adoptPlan(plan('p1', [sled()]));
    store.deletePlan('p1');

    expect(store.getState().customExercises.map((exercise) => exercise.id)).toEqual(['x:tire-flip']);
  });

  it('lets a later plan use a saved movement by id alone', () => {
    const library = [sled()];
    const later = parsePortablePlan(planUsing(['x:tire-flip'])).plan;
    if (!later) throw new Error('fixture did not parse');

    const filled = withSavedMovements(later, library);

    expect(filled.exercises?.map((exercise) => exercise.id)).toEqual(['x:tire-flip']);
    expect(validatePlan(filled).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('still reports an id that nothing defines', () => {
    const later = parsePortablePlan(planUsing(['x:no-such-thing'])).plan;
    if (!later) throw new Error('fixture did not parse');

    expect(validatePlan(withSavedMovements(later, [])).ok).toBe(false);
  });

  it('resolves after the plan that defined it is gone', () => {
    expect(resolveExercise('x:tire-flip', { customExercises: [sled()] })?.name).toBe('Tire flip');
  });

  it('is seeded from saved plans when upgrading from before it existed', () => {
    const old = JSON.parse(JSON.stringify({ ...defaultState(), plans: [plan('p1', [sled()])] })) as Record<
      string,
      unknown
    >;
    delete old['customExercises'];

    expect(parseState(old).state.customExercises.map((exercise) => exercise.id)).toEqual(['x:tire-flip']);
  });

  it('syncs between devices', () => {
    const phone = defaultState();
    const pc = { ...defaultState(), customExercises: [sled()] };

    expect(mergeStates(phone, pc, fingerprint(phone)).customExercises).toHaveLength(1);
  });
});

describe('llms.txt examples', () => {
  it('only ever show complete movements', () => {
    const blocks = [...buildLlmsTxt().matchAll(/```(?:json)?\n([\s\S]*?)```/g)].map(
      (match) => match[1] ?? '',
    );

    for (const block of blocks) {
      const input = block.trim().startsWith('rf1')
        ? expandCompactPlan(block.trim().replace(/\n/g, '~'))
        : block;
      if (!input) continue;
      const parsed = parsePortablePlan(input);
      if (parsed.plan) expect(parsed.incomplete).toEqual([]);
    }
  });
});

describe('a half-described movement the catalogue already has', () => {
  it('becomes the built-in instead of refusing the week', () => {
    const parsed = parsePortablePlan(
      planUsing(
        ['x:push-ups', 'x:pull-ups'],
        [{ name: 'Push-ups' }, { id: 'pull-ups', name: 'Pull ups', sets: 3 }],
      ),
    );
    const tuesday = parsed.plan?.days.find((day) => day.dayKey === 'tue');

    expect(parsed.incomplete).toEqual([]);
    expect(tuesday?.exerciseIds).toEqual(['pushup', 'pullup']);
    expect(parsed.plan?.exercises).toBeUndefined();
  });

  it('resolves a sloppy reference to a built-in with no definition at all', () => {
    const tuesday = parsePortablePlan(planUsing(['push-ups', 'Pull-Ups'])).plan?.days.find(
      (day) => day.dayKey === 'tue',
    );

    expect(tuesday?.exerciseIds).toEqual(['pushup', 'pullup']);
  });

  it('keeps a complete definition as the plan’s own, even under a built-in’s name', () => {
    const parsed = parsePortablePlan(
      planUsing(['x:push-ups'], [{ ...SLED, id: 'push-ups', name: 'Push-ups' }]),
    );

    expect(parsed.plan?.exercises?.[0]?.id).toBe('x:push-ups');
  });
});
