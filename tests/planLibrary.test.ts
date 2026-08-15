import { describe, expect, it } from 'vitest';

import type { UserPlan } from '@/types';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { defaultState, parseState } from '@/state/schema';
import { activePlan } from '@/data/catalogue';
import { describePlanName } from '@/data/activePlan';

/**
 * The plan library.
 *
 * Adopting a plan used to overwrite the previous one, so trying a week your
 * LLM wrote destroyed the block you had been running. These tests pin the two
 * properties that fixes: keeping a plan is not destructive, and there is
 * always a week in force even when the library is empty or the selection is
 * stale.
 */

function plan(id: string, overrides: Partial<UserPlan> = {}): UserPlan {
  return {
    id,
    summary: `Summary for ${id}`,
    days: [
      {
        dayKey: 'tue',
        label: 'Strength',
        type: 'strength',
        sub: '',
        note: '',
        outline: ['Lift'],
        aerobic: false,
        exerciseIds: ['legpress'],
      },
    ],
    generatedAt: 1_700_000_000_000,
    model: 'test-model',
    ...overrides,
  };
}

function newStore(): AppStore {
  return new AppStore({
    initialState: defaultState(),
    store: createMemoryStore(),
    saveDelayMs: 0,
    now: () => 1_700_000_000_000,
  });
}

describe('adopting plans', () => {
  it('keeps the previous plan instead of overwriting it', () => {
    // The entire point of the library.
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.adoptPlan(plan('b'));

    expect(store.getState().plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(activePlan(store.getState())?.id).toBe('b');
  });

  it('replaces in place rather than duplicating when the same plan is re-adopted', () => {
    const store = newStore();
    store.adoptPlan(plan('a', { summary: 'First' }));
    store.adoptPlan(plan('a', { summary: 'Revised' }));

    expect(store.getState().plans).toHaveLength(1);
    expect(store.getState().plans[0]?.summary).toBe('Revised');
  });

  it('starts with an empty library and the built-in plan in force', () => {
    const store = newStore();

    expect(store.getState().plans).toEqual([]);
    expect(activePlan(store.getState())).toBeNull();
  });
});

describe('selecting', () => {
  it('switches between saved plans', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.adoptPlan(plan('b'));

    store.selectPlan('a');
    expect(activePlan(store.getState())?.id).toBe('a');
  });

  it('goes back to the built-in rotation with null', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.selectPlan(null);

    expect(activePlan(store.getState())).toBeNull();
    // Reverting is not deleting — the plan is still there to switch back to.
    expect(store.getState().plans).toHaveLength(1);
  });

  it('ignores an id that is not in the library', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.selectPlan('nonexistent');

    expect(activePlan(store.getState())?.id).toBe('a');
  });
});

describe('deleting', () => {
  it('removes a plan and leaves the rest alone', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.adoptPlan(plan('b'));

    store.deletePlan('a');
    expect(store.getState().plans.map((p) => p.id)).toEqual(['b']);
  });

  it('falls back to the built-in rotation when the plan in force is deleted', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.deletePlan('a');

    expect(activePlan(store.getState())).toBeNull();
  });

  it('leaves the selection alone when some other plan is deleted', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.adoptPlan(plan('b'));
    store.selectPlan('a');

    store.deletePlan('b');
    expect(activePlan(store.getState())?.id).toBe('a');
  });

  it('does not touch logged history', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.logSet('tue', 'legpress', 180, 10, 'lb');
    store.finishActive('tue', null);

    store.deletePlan('a');
    expect(store.getState().sessions[0]?.sets).toHaveLength(1);
  });
});

describe('naming', () => {
  it('falls back to the model and date until named', () => {
    expect(describePlanName(plan('a'))).toContain('test-model');
  });

  it('uses the name once set', () => {
    const store = newStore();
    store.adoptPlan(plan('a'));
    store.renamePlan('a', '  Winter block  ');

    const saved = store.getState().plans[0];
    expect(saved?.name).toBe('Winter block');
    expect(saved && describePlanName(saved)).toBe('Winter block');
  });

  it('clears the name when blanked, restoring the default label', () => {
    const store = newStore();
    store.adoptPlan(plan('a', { name: 'Winter block' }));
    store.renamePlan('a', '   ');

    const saved = store.getState().plans[0];
    expect(saved?.name).toBeUndefined();
    expect(saved && describePlanName(saved)).toContain('test-model');
  });
});

describe('persistence', () => {
  it('migrates the single-plan shape of schema 8', () => {
    /*
     * Upgrading must be invisible: the week you were running is the week you
     * are still running, now as the library's only entry.
     */
    const { state } = parseState({
      sessions: [],
      plan: { id: 'old', summary: 'The one I was running', days: [{ dayKey: 'tue' }], model: 'gemini' },
    });

    expect(state.plans.map((p) => p.id)).toEqual(['old']);
    expect(state.activePlanId).toBe('old');
    expect(activePlan(state)?.summary).toBe('The one I was running');
  });

  it('prefers a real library over a legacy plan when both are present', () => {
    const { state } = parseState({
      sessions: [],
      plans: [{ id: 'new', summary: 'Current', days: [{ dayKey: 'tue' }] }],
      activePlanId: 'new',
      plan: { id: 'old', summary: 'Stale', days: [{ dayKey: 'tue' }] },
    });

    expect(state.plans.map((p) => p.id)).toEqual(['new']);
  });

  it('round-trips a library and its selection', () => {
    const { state } = parseState({
      sessions: [],
      plans: [
        { id: 'a', name: 'Winter block', summary: '', days: [{ dayKey: 'tue' }] },
        { id: 'b', summary: '', days: [{ dayKey: 'tue' }] },
      ],
      activePlanId: 'b',
    });

    expect(state.plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(state.plans[0]?.name).toBe('Winter block');
    expect(state.activePlanId).toBe('b');
  });

  it('drops a selection pointing at a plan that is not there', () => {
    // A hand-edited backup, or a plan deleted out from under the id.
    const { state } = parseState({
      sessions: [],
      plans: [{ id: 'a', summary: '', days: [{ dayKey: 'tue' }] }],
      activePlanId: 'ghost',
    });

    expect(state.activePlanId).toBeNull();
    expect(activePlan(state)).toBeNull();
  });

  it('drops duplicate ids rather than letting two plans share one', () => {
    const { state } = parseState({
      sessions: [],
      plans: [
        { id: 'a', summary: 'First', days: [{ dayKey: 'tue' }] },
        { id: 'a', summary: 'Impostor', days: [{ dayKey: 'tue' }] },
      ],
    });

    expect(state.plans).toHaveLength(1);
    expect(state.plans[0]?.summary).toBe('First');
  });

  it('caps how many plans a restored backup can carry', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      summary: '',
      days: [{ dayKey: 'tue' }],
    }));
    const { state } = parseState({ sessions: [], plans: many });

    expect(state.plans.length).toBeLessThanOrEqual(50);
  });

  it('survives a library field that is nonsense', () => {
    for (const plans of [null, 'not an array', 42, [null, 3, {}]]) {
      expect(() => parseState({ sessions: [], plans })).not.toThrow();
    }
  });
});
