import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultState } from '@/state/schema';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';

/*
 * The once-a-week "which workout plan?" question: asked in a new week, never
 * in the week someone starts, and answered once for the whole week.
 */

const WEDNESDAY = new Date(2026, 8, 23, 10, 0);
const NEXT_MONDAY = new Date(2026, 8, 28, 9, 0);

function makeStore(): AppStore {
  return new AppStore({ initialState: defaultState(), store: createMemoryStore(), saveDelayMs: 0 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WEDNESDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the weekly workout plan question', () => {
  it('is not asked in the week someone starts', () => {
    const store = makeStore();
    store.setWelcomed(true);

    expect(store.needsWeekChoice()).toBe(false);
  });

  it('is asked once a new week has started, and answering clears it for that week', () => {
    const store = makeStore();
    store.setWelcomed(true);

    vi.setSystemTime(NEXT_MONDAY);
    expect(store.needsWeekChoice()).toBe(true);

    store.confirmWeek();
    expect(store.needsWeekChoice()).toBe(false);
  });

  it('counts adopting a new plan as this week’s answer', () => {
    const store = makeStore();
    store.setWelcomed(true);
    vi.setSystemTime(NEXT_MONDAY);

    store.adoptPlan({ id: 'p1', summary: '', days: [], generatedAt: 1, model: 'test' });
    expect(store.needsWeekChoice()).toBe(false);
  });

  it('is never asked before the first-run screen has been answered', () => {
    const store = makeStore();
    vi.setSystemTime(NEXT_MONDAY);

    expect(store.needsWeekChoice()).toBe(false);
  });
});
