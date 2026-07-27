import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppState, Session } from '@/types';
import { defaultState } from '@/state/schema';
import type { Listener } from '@/state/store';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { todayIso } from '@/domain/dates';

function makeStore(initial: AppState = defaultState()): AppStore {
  return new AppStore({
    initialState: initial,
    store: createMemoryStore(),
    // Write through synchronously so assertions do not race the debounce.
    saveDelayMs: 0,
    now: () => 1_700_000_000_000,
  });
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sX',
    date: todayIso(),
    dayKey: 'tue',
    sets: [],
    minutes: null,
    modality: null,
    effort: null,
    startedAt: 0,
    ...overrides,
  };
}

describe('logging sets', () => {
  it('creates the active session on the first set', () => {
    const store = makeStore();
    expect(store.activeFor('tue')).toBeNull();

    store.logSet('tue', 'legpress', 180, 10, 'lb');

    const active = store.activeFor('tue');
    expect(active?.sets).toHaveLength(1);
    expect(active?.sets[0]).toMatchObject({ exerciseId: 'legpress', weight: 180, reps: 10, unit: 'lb' });
  });

  it('records the unit the set was logged in', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 80, 10, 'kg');
    expect(store.activeFor('tue')?.sets[0]?.unit).toBe('kg');
  });

  it('clamps hostile input before it reaches the state', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', -999, 99_999, 'lb');

    expect(store.activeFor('tue')?.sets[0]).toMatchObject({ weight: 0, reps: 999 });
  });

  it('undoes only the last set of the named exercise', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    store.logSet('tue', 'chestpress', 60, 10, 'lb');
    store.logSet('tue', 'legpress', 110, 8, 'lb');

    store.undoLastSet('tue', 'legpress');

    const sets = store.activeFor('tue')?.sets ?? [];
    expect(sets).toHaveLength(2);
    expect(sets.map((s) => s.exerciseId)).toEqual(['legpress', 'chestpress']);
    expect(sets[0]?.weight).toBe(100);
  });

  it('is a no-op when there is nothing to undo', () => {
    const store = makeStore();
    expect(() => store.undoLastSet('tue', 'legpress')).not.toThrow();
  });

  it('keeps separate active sessions from bleeding across plan days', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    expect(store.activeFor('fri')).toBeNull();
  });
});

describe('finishing a session', () => {
  it('moves the active session into history', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    expect(store.finishActive('tue', null)).toBe(true);
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().active).toBeNull();
  });

  it('stamps a finish time', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    store.finishActive('tue', null);

    expect(store.getState().sessions[0]?.finishedAt).toBe(1_700_000_000_000);
  });

  it('refuses to save a session with nothing in it', () => {
    const store = makeStore();
    expect(store.finishActive('tue', null)).toBe(false);
    expect(store.getState().sessions).toHaveLength(0);
  });

  it('applies the day default minutes when none were entered', () => {
    const store = makeStore();
    expect(store.finishActive('wed', 35)).toBe(true);
    expect(store.getState().sessions[0]?.minutes).toBe(35);
  });

  it('does not overwrite minutes the user actually entered', () => {
    const store = makeStore();
    store.setMinutes('wed', 50);
    store.finishActive('wed', 35);
    expect(store.getState().sessions[0]?.minutes).toBe(50);
  });
});

describe('carried-over sessions', () => {
  const yesterday: Session = session({
    id: 'stale',
    date: '2020-01-01',
    sets: [{ exerciseId: 'legpress', weight: 100, unit: 'lb', reps: 10, loggedAt: 0 }],
  });

  it('does not treat an old session as the active one for today', () => {
    const store = makeStore({ ...defaultState(), active: yesterday });
    expect(store.activeFor('tue')).toBeNull();
  });

  it('surfaces it instead of discarding it', () => {
    // v0.1 dropped this silently on load, losing whatever had been logged.
    const store = makeStore({ ...defaultState(), active: yesterday });
    expect(store.staleActive()?.id).toBe('stale');
  });

  it('saves it under its own date, not today', () => {
    const store = makeStore({ ...defaultState(), active: yesterday });
    expect(store.keepStaleActive()).toBe(true);

    expect(store.getState().sessions[0]?.date).toBe('2020-01-01');
    expect(store.getState().active).toBeNull();
  });

  it('reports nothing to keep when the carried-over session is empty', () => {
    const store = makeStore({ ...defaultState(), active: session({ date: '2020-01-01' }) });
    expect(store.keepStaleActive()).toBe(false);
  });

  it("does not report today's in-progress session as stale", () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    expect(store.staleActive()).toBeNull();
  });
});

describe('switching plan days mid-session', () => {
  it('preserves the open session instead of overwriting it', () => {
    // Tapping through to another day from the week strip and logging a set used
    // to destroy whatever was already in progress.
    const store = makeStore();
    store.logSet('mon', 'plank', 0, 30, 'lb');
    store.logSet('tue', 'legpress', 185, 8, 'lb');

    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]?.dayKey).toBe('mon');
    expect(store.getState().sessions[0]?.sets[0]?.exerciseId).toBe('plank');
  });

  it('leaves the new day as the active session', () => {
    const store = makeStore();
    store.logSet('mon', 'plank', 0, 30, 'lb');
    store.logSet('tue', 'legpress', 185, 8, 'lb');

    expect(store.getState().active?.dayKey).toBe('tue');
    expect(store.getState().active?.sets).toHaveLength(1);
  });

  it('announces what it filed so the user is not surprised', () => {
    const onSessionFiled = vi.fn();
    const store = new AppStore({
      initialState: defaultState(),
      store: createMemoryStore(),
      saveDelayMs: 0,
      onSessionFiled,
    });

    store.logSet('mon', 'plank', 0, 30, 'lb');
    store.logSet('tue', 'legpress', 185, 8, 'lb');

    expect(onSessionFiled).toHaveBeenCalledTimes(1);
    expect(onSessionFiled.mock.calls[0]?.[0]).toMatchObject({ dayKey: 'mon' });
  });

  it('discards an empty session rather than filing a blank one', () => {
    const store = makeStore();
    store.toggleModality('mon', 'Treadmill', null);
    store.discardActive();
    store.logSet('tue', 'legpress', 185, 8, 'lb');

    expect(store.getState().sessions).toHaveLength(0);
  });

  it('preserves the open session when another day is finished', () => {
    // A ticking clock, so the two same-date sessions order by start time the
    // way they would in the app rather than by their random ids.
    let tick = 1_700_000_000_000;
    const store = new AppStore({
      initialState: defaultState(),
      store: createMemoryStore(),
      saveDelayMs: 0,
      now: () => (tick += 1000),
    });

    store.logSet('mon', 'plank', 0, 30, 'lb');
    store.logSet('tue', 'legpress', 185, 8, 'lb');
    store.finishActive('tue', null);

    expect(store.getState().sessions.map((s) => s.dayKey)).toEqual(['mon', 'tue']);
    expect(store.getState().active).toBeNull();
  });

  it('preserves the open session even when the finish is a no-op', () => {
    const store = makeStore();
    store.logSet('mon', 'plank', 0, 30, 'lb');

    expect(store.finishActive('tue', null)).toBe(false);
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0]?.dayKey).toBe('mon');
  });

  it('does not file anything when staying on the same day', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 185, 8, 'lb');
    store.logSet('tue', 'legpress', 185, 8, 'lb');

    expect(store.getState().sessions).toHaveLength(0);
    expect(store.getState().active?.sets).toHaveLength(2);
  });
});

describe('reopening and deleting', () => {
  it('moves a finished session back to active and clears its finish time', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    store.finishActive('tue', null);
    const id = store.getState().sessions[0]?.id ?? '';

    expect(store.reopenSession(id)).toBe(true);
    expect(store.getState().sessions).toHaveLength(0);
    expect(store.getState().active?.id).toBe(id);
    expect(store.getState().active?.finishedAt).toBeUndefined();
  });

  it('refuses to reopen while another session is in progress, rather than discarding it', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    store.finishActive('tue', null);
    const id = store.getState().sessions[0]?.id ?? '';
    store.logSet('fri', 'splitsquat', 50, 8, 'lb');

    expect(store.reopenSession(id)).toBe(false);
    expect(store.getState().sessions).toHaveLength(1);
  });

  it('deletes by id', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 100, 10, 'lb');
    store.finishActive('tue', null);
    const id = store.getState().sessions[0]?.id ?? '';

    store.deleteSession(id);
    expect(store.getState().sessions).toHaveLength(0);
  });

  it('ignores deletion of an unknown id', () => {
    const store = makeStore();
    store.deleteSession('nope');
    expect(store.getState().sessions).toHaveLength(0);
  });
});

describe('toggles', () => {
  it('clears the modality when the same one is chosen again', () => {
    const store = makeStore();
    store.toggleModality('wed', 'Easy laps', 35);
    expect(store.activeFor('wed')?.modality).toBe('Easy laps');

    store.toggleModality('wed', 'Easy laps', 35);
    expect(store.activeFor('wed')?.modality).toBeNull();
  });

  it('seeds the default minutes when a modality is first chosen', () => {
    const store = makeStore();
    store.toggleModality('wed', 'Easy laps', 35);
    expect(store.activeFor('wed')?.minutes).toBe(35);
  });

  it('does not overwrite minutes already entered', () => {
    const store = makeStore();
    store.setMinutes('wed', 12);
    store.toggleModality('wed', 'Easy laps', 35);
    expect(store.activeFor('wed')?.minutes).toBe(12);
  });

  it('toggles effort off', () => {
    const store = makeStore();
    store.toggleEffort('wed', 'Hard', 35);
    store.toggleEffort('wed', 'Hard', 35);
    expect(store.activeFor('wed')?.effort).toBeNull();
  });
});

describe('persistence and subscribers', () => {
  let listener: Mock<Listener>;

  beforeEach(() => {
    listener = vi.fn<Listener>();
  });

  it('notifies subscribers on change', () => {
    const store = makeStore();
    store.subscribe(listener);
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = makeStore();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    expect(listener).not.toHaveBeenCalled();
  });

  it('writes through to the backing store', () => {
    const backing = createMemoryStore();
    const store = new AppStore({ initialState: defaultState(), store: backing, saveDelayMs: 0 });
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    const raw = backing.getItem('rackfile:state');
    expect(raw).toContain('legpress');
  });

  it('reports a failed write instead of losing it silently', () => {
    const onSaveError = vi.fn();
    const failing = {
      getItem: () => null,
      setItem: () => {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      },
      removeItem: () => {},
    };

    const store = new AppStore({
      initialState: defaultState(),
      store: failing,
      saveDelayMs: 0,
      onSaveError,
    });
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    expect(onSaveError).toHaveBeenCalledWith('quota');
  });

  it('treats state as immutable — the previous object is not mutated', () => {
    const store = makeStore();
    const before = store.getState();
    store.logSet('tue', 'legpress', 100, 10, 'lb');

    expect(before.active).toBeNull();
    expect(store.getState()).not.toBe(before);
  });
});

describe('preferences', () => {
  it('changes the unit without touching logged sets', () => {
    const store = makeStore();
    store.logSet('tue', 'legpress', 180, 10, 'lb');
    store.setUnit('kg');

    expect(store.getState().prefs.unit).toBe('kg');
    expect(store.activeFor('tue')?.sets[0]).toMatchObject({ weight: 180, unit: 'lb' });
  });
});
