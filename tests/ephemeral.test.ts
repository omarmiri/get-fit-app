import { beforeEach, describe, expect, it } from 'vitest';

import {
  conditionsList,
  getConditionsText,
  getNotes,
  resetEphemeral,
  setConditionsText,
  setNotes,
} from '@/state/ephemeral';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { defaultState, parseState, serializeState } from '@/state/schema';

/**
 * Health context is used, not kept.
 *
 * It shapes what a sensible training week looks like, so a model writing one
 * needs it. It does not follow that the app should hold onto it. These tests
 * pin that: nothing typed as health context reaches persisted state, and
 * anything an older version already saved is actively removed rather than
 * merely ignored.
 */

beforeEach(resetEphemeral);

describe('ephemeral inputs', () => {
  it('holds what was typed for the current session', () => {
    setConditionsText('high cholesterol, high glucose');
    setNotes('sore left shoulder');

    expect(getConditionsText()).toBe('high cholesterol, high glucose');
    expect(getNotes()).toBe('sore left shoulder');
  });

  it('splits health context into a list for the prompt builders', () => {
    setConditionsText(' high cholesterol ,, high glucose , ');

    expect(conditionsList()).toEqual(['high cholesterol', 'high glucose']);
  });

  it('is empty for a fresh session', () => {
    expect(getConditionsText()).toBe('');
    expect(conditionsList()).toEqual([]);
  });
});

describe('never reaching storage', () => {
  it('is absent from a serialized state after being typed', () => {
    // The guarantee in one assertion: type it, save, and it is not in the
    // bytes that go to localStorage.
    setConditionsText('recovering from a hernia repair');

    const store = new AppStore({
      initialState: defaultState(),
      store: createMemoryStore(),
      saveDelayMs: 0,
    });
    store.setGym('Commercial gym');

    const serialized = serializeState(store.getState());
    expect(serialized).not.toContain('hernia');
    expect(serialized).not.toContain('conditions');
  });

  it('has no store action that could persist it', () => {
    const store = new AppStore({ initialState: defaultState(), store: createMemoryStore() });

    expect((store as unknown as Record<string, unknown>)['setConditions']).toBeUndefined();
  });
});

describe('removing what older versions saved', () => {
  it('drops health context that is already in stored state', () => {
    /*
     * Schema 9 and earlier saved this as a preference. Dropping the field from
     * the type alone would leave those strings sitting in existing users'
     * storage until something else rewrote the key. The parse has to actively
     * remove it.
     */
    const { state } = parseState({
      sessions: [],
      prefs: { unit: 'lb', conditions: ['high cholesterol'], gym: 'Commercial gym' },
    });

    expect(serializeState(state)).not.toContain('cholesterol');
    expect((state.prefs as unknown as Record<string, unknown>)['conditions']).toBeUndefined();
  });

  it('keeps the preferences alongside it', () => {
    // Removing one field must not take the rest of the user's settings with it.
    const { state } = parseState({
      sessions: [],
      prefs: { unit: 'kg', conditions: ['high glucose'], gym: 'Home gym', restVibrate: false },
    });

    expect(state.prefs.unit).toBe('kg');
    expect(state.prefs.gym).toBe('Home gym');
    expect(state.prefs.restVibrate).toBe(false);
  });
});
