import { describe, expect, it } from 'vitest';

import type { AppState, Exercise, UserPlan } from '@/types';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { defaultState, parseState } from '@/state/schema';
import { activePlan, catalogueFor, exerciseSourceOf, resolveExercise } from '@/data/catalogue';
import { sessionVolume } from '@/domain/metrics';
import { trendableExercises } from '@/state/selectors';

/**
 * The archive of movements already logged against.
 *
 * A custom movement lives in the plan that defined it, so replacing the plan
 * would strand every set logged against it — the numbers survive but nothing
 * can say what they were. These tests pin the guarantee that history stays
 * legible across a plan change, which is the whole reason the field exists.
 */

function customExercise(id: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: `Movement ${id}`,
    source: 'plan',
    summary: 'Something the app has never heard of.',
    sets: 3,
    repRange: '8–12',
    repMin: 8,
    repMax: 12,
    defaultReps: 10,
    repMetric: 'reps',
    loaded: true,
    restSeconds: 90,
    cues: { setup: 'Set up.', execute: 'Do it.', avoid: 'Do not do that.' },
    ...overrides,
  };
}

function planWith(exercises: readonly Exercise[]): UserPlan {
  return {
    id: 'plan-test',
    summary: 'Test plan.',
    days: [
      {
        dayKey: 'tue',
        label: 'Strength',
        type: 'strength',
        sub: '',
        note: '',
        outline: ['Lift'],
        aerobic: false,
        exerciseIds: exercises.map((e) => e.id),
      },
    ],
    exercises,
    generatedAt: 1_700_000_000_000,
    model: 'test-model',
  };
}

function storeWithPlan(plan: UserPlan): AppStore {
  const store = new AppStore({
    initialState: defaultState(),
    store: createMemoryStore(),
    // Write through synchronously so assertions do not race the debounce.
    saveDelayMs: 0,
    now: () => 1_700_000_000_000,
  });
  store.adoptPlan(plan);
  return store;
}

describe('archiving on log', () => {
  it('keeps a copy of a custom movement the first time it is logged', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));

    expect(store.getState().exerciseArchive).toEqual([]);
    store.logSet('tue', 'x:sled-push', 90, 10, 'lb');

    expect(store.getState().exerciseArchive.map((e) => e.id)).toEqual(['x:sled-push']);
  });

  it('does not archive built-in movements, which need no rescuing', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));
    store.logSet('tue', 'legpress', 180, 10, 'lb');

    expect(store.getState().exerciseArchive).toEqual([]);
  });

  it('archives each movement once, however many sets are logged', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));
    for (let i = 0; i < 5; i += 1) store.logSet('tue', 'x:sled-push', 90, 10, 'lb');

    expect(store.getState().exerciseArchive).toHaveLength(1);
  });

  it('does not archive a movement that was only ever planned', () => {
    // The archive holds what was performed, not every movement of every plan
    // the user has tried on.
    const store = storeWithPlan(planWith([customExercise('x:done'), customExercise('x:skipped')]));
    store.logSet('tue', 'x:done', 50, 10, 'lb');

    expect(store.getState().exerciseArchive.map((e) => e.id)).toEqual(['x:done']);
  });
});

describe('surviving a plan change', () => {
  it('still resolves a logged movement after the plan that defined it is gone', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push', { name: 'Sled push' })]));
    store.logSet('tue', 'x:sled-push', 90, 10, 'lb');

    store.selectPlan(null);

    expect(activePlan(store.getState())).toBeNull();
    expect(resolveExercise('x:sled-push', exerciseSourceOf(store.getState()))?.name).toBe('Sled push');
  });

  it('still resolves it after a different plan is adopted', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push', { name: 'Sled push' })]));
    store.logSet('tue', 'x:sled-push', 90, 10, 'lb');

    store.adoptPlan(planWith([customExercise('x:farmers-walk', { name: "Farmer's walk" })]));

    expect(resolveExercise('x:sled-push', exerciseSourceOf(store.getState()))?.name).toBe('Sled push');
    expect(resolveExercise('x:farmers-walk', exerciseSourceOf(store.getState()))?.name).toBe("Farmer's walk");
  });

  it('counts an orphaned movement toward session volume', () => {
    // The bug this fixes end to end: the sets were always there, but nothing
    // could say whether they were reps or seconds, so volume silently skipped
    // them or counted a plank's seconds as repetitions.
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));
    store.logSet('tue', 'x:sled-push', 100, 10, 'lb');
    store.finishActive('tue', null);
    store.selectPlan(null);

    const sets = store.getState().sessions[0]?.sets ?? [];
    expect(sessionVolume(sets, 'lb', exerciseSourceOf(store.getState()))).toBe(1000);
  });

  it('excludes a timed movement from volume even once orphaned', () => {
    const store = storeWithPlan(
      planWith([customExercise('x:hollow-hold', { repMetric: 'seconds', loaded: false })]),
    );
    store.logSet('tue', 'x:hollow-hold', 0, 45, 'lb');
    store.finishActive('tue', null);
    store.selectPlan(null);

    const sets = store.getState().sessions[0]?.sets ?? [];
    expect(sessionVolume(sets, 'lb', exerciseSourceOf(store.getState()))).toBe(0);
  });

  it('prefers the current plan when it redefines an archived id', () => {
    /*
     * The plan describes what to do now; the archive explains what was done
     * then. When both can answer, the current instruction wins.
     */
    const store = storeWithPlan(planWith([customExercise('x:row', { name: 'Row, first version' })]));
    store.logSet('tue', 'x:row', 60, 10, 'lb');

    store.adoptPlan(planWith([customExercise('x:row', { name: 'Row, revised' })]));

    expect(resolveExercise('x:row', exerciseSourceOf(store.getState()))?.name).toBe('Row, revised');
    expect(store.getState().exerciseArchive[0]?.name).toBe('Row, first version');
  });
});

describe('the trend picker', () => {
  it('offers a logged custom movement alongside the built-ins', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push', { name: 'Sled push' })]));
    store.logSet('tue', 'x:sled-push', 90, 10, 'lb');
    store.finishActive('tue', null);

    expect(trendableExercises(store.getState()).map((e) => e.id)).toContain('x:sled-push');
  });

  it('keeps offering it after the plan is replaced', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));
    store.logSet('tue', 'x:sled-push', 90, 10, 'lb');
    store.finishActive('tue', null);
    store.selectPlan(null);

    expect(trendableExercises(store.getState()).map((e) => e.id)).toContain('x:sled-push');
  });

  it('leaves out a movement that is defined but never logged', () => {
    const store = storeWithPlan(planWith([customExercise('x:sled-push')]));

    expect(trendableExercises(store.getState()).map((e) => e.id)).not.toContain('x:sled-push');
  });
});

describe('catalogueFor', () => {
  it('returns the built-in catalogue untouched when nothing is custom', () => {
    expect(catalogueFor({})).toBe(catalogueFor({ plan: null }));
  });

  it('lists a movement once when both the plan and the archive define it', () => {
    const archived = customExercise('x:row', { name: 'Old' });
    const planned = customExercise('x:row', { name: 'New' });

    const listed = catalogueFor({ plan: planWith([planned]), exerciseArchive: [archived] }).filter(
      (e) => e.id === 'x:row',
    );

    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('New');
  });
});

describe('persistence', () => {
  const stateWith = (raw: Record<string, unknown>): AppState => parseState(raw).state;

  const sessionUsing = (exerciseId: string): Record<string, unknown> => ({
    id: 's1',
    date: '2026-08-01',
    dayKey: 'tue',
    sets: [{ exerciseId, weight: 90, reps: 10, unit: 'lb', loggedAt: 1_700_000_000_000 }],
    minutes: null,
    modality: null,
    effort: null,
    startedAt: 1_700_000_000_000,
  });

  it('round-trips an archived movement', () => {
    const state = stateWith({
      sessions: [sessionUsing('x:sled-push')],
      exerciseArchive: [{ id: 'x:sled-push', name: 'Sled push', loaded: true }],
    });

    expect(state.exerciseArchive.map((e) => e.id)).toEqual(['x:sled-push']);
  });

  it('drops an archived movement nothing references any more', () => {
    // Deleting the sessions that used a movement should not leave its
    // definition behind for ever.
    const state = stateWith({
      sessions: [],
      exerciseArchive: [{ id: 'x:sled-push', name: 'Sled push', loaded: true }],
    });

    expect(state.exerciseArchive).toEqual([]);
  });

  it('back-fills from the plan for state written before the archive existed', () => {
    /*
     * The schema 7 upgrade. Someone who had already logged a custom movement
     * keeps it, so long as the plan defining it is still in force.
     */
    const state = stateWith({
      sessions: [sessionUsing('x:sled-push')],
      plan: {
        id: 'plan-old',
        summary: '',
        days: [{ dayKey: 'tue', label: 'Strength', type: 'strength', outline: ['Lift'], aerobic: false }],
        exercises: [{ id: 'x:sled-push', name: 'Sled push', loaded: true }],
        generatedAt: 1_700_000_000_000,
        model: 'old',
      },
    });

    expect(state.exerciseArchive.map((e) => e.id)).toEqual(['x:sled-push']);
  });

  it('survives an archive field that is nonsense', () => {
    for (const exerciseArchive of [null, 'not an array', 42, [null, 3, {}]]) {
      expect(() => stateWith({ sessions: [], exerciseArchive })).not.toThrow();
    }
  });
});
