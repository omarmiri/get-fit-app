import { describe, expect, it } from 'vitest';

import { VENUES, describeGym, hasAnswers } from '@/domain/gymProfile';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';
import { defaultState, parseState } from '@/state/schema';

/**
 * Turning gym answers into the sentences a model reads.
 *
 * This exists because the field it replaced was a blank box, which stayed
 * blank — so the prompt told the model to assume a commercial gym and guess.
 * The tests that matter are the ones checking the generated prose actually
 * says something a plan can be built on.
 */

function store(): AppStore {
  return new AppStore({
    initialState: defaultState(),
    store: createMemoryStore(),
    saveDelayMs: 0,
  });
}

describe('describeGym', () => {
  it('says nothing when nothing has been answered', () => {
    // Must be indistinguishable from an absent profile, so the prompt falls
    // back to telling the model to assume rather than sending an empty claim.
    expect(describeGym({})).toBe('');
    expect(hasAnswers({})).toBe(false);
  });

  it('names the venue', () => {
    expect(describeGym({ venue: 'chain' })).toContain('large commercial gym');
    expect(describeGym({ venue: 'apartment' })).toContain('apartment or condo');
    expect(describeGym({ venue: 'home' })).toContain('at home');
  });

  it('lists the equipment', () => {
    const text = describeGym({ venue: 'home', equipment: ['dumbbells', 'pullupbar', 'bands'] });

    expect(text).toContain('dumbbells');
    expect(text).toContain('pull-up bar');
    expect(text).toContain('resistance bands');
  });

  it('says so explicitly when a venue has no equipment', () => {
    // "No gym" is a real answer, not an oversight. Stating it beats leaving
    // the model to infer it from an absence.
    expect(describeGym({ venue: 'outdoor' })).toContain('bodyweight');
  });

  it('distinguishes cannot-train-outdoors from not-asked', () => {
    expect(describeGym({ outdoors: true })).toContain('can run or walk outdoors');
    expect(describeGym({ outdoors: false })).toContain('cannot train outdoors');
    expect(describeGym({ daysPerWeek: 3 })).not.toContain('outdoors');
  });

  it('carries the constraints that decide what fits', () => {
    const text = describeGym({ daysPerWeek: 3, sessionMinutes: 45 });

    expect(text).toContain('3 days a week');
    expect(text).toContain('45 minutes');
  });

  it('reads as sentences, not a data dump', () => {
    const text = describeGym({
      venue: 'chain',
      equipment: ['dumbbells', 'cables'],
      outdoors: true,
      daysPerWeek: 4,
      sessionMinutes: 60,
    });

    expect(text.startsWith('I train at')).toBe(true);
    expect(text.endsWith('.')).toBe(true);
  });
});

describe('venue presets', () => {
  it('gives every venue a label and an example', () => {
    for (const venue of VENUES) {
      expect(venue.label, venue.id).toBeTruthy();
      expect(venue.hint, venue.id).toBeTruthy();
    }
  });

  it('implies nothing for the no-gym option', () => {
    expect(VENUES.find((v) => v.id === 'outdoor')?.implies).toEqual([]);
  });
});

describe('saving answers', () => {
  it('writes the prose the prompt will use', () => {
    const s = store();
    s.setGymProfile({ venue: 'rec', equipment: ['pool', 'dumbbells'], daysPerWeek: 3 });

    expect(s.getState().prefs.gym).toContain('rec center');
    expect(s.getState().prefs.gym).toContain('swimming pool');
    expect(s.getState().prefs.gymProfile?.venue).toBe('rec');
  });

  it('clears the prose when every answer is cleared', () => {
    const s = store();
    s.setGymProfile({ venue: 'chain' });
    s.setGymProfile({});

    expect(s.getState().prefs.gym).toBeUndefined();
  });

  it('keeps a hand-written description until an answer changes', () => {
    const s = store();
    s.setGym('The squat racks are always taken after 5pm.');

    expect(s.getState().prefs.gym).toContain('squat racks');
  });
});

describe('persistence', () => {
  it('round-trips the answers', () => {
    const { state } = parseState({
      sessions: [],
      prefs: {
        unit: 'lb',
        gymProfile: { venue: 'home', equipment: ['dumbbells', 'bench'], outdoors: true, daysPerWeek: 4 },
      },
    });

    expect(state.prefs.gymProfile).toEqual({
      venue: 'home',
      equipment: ['dumbbells', 'bench'],
      outdoors: true,
      daysPerWeek: 4,
    });
  });

  it('drops values it does not recognise rather than guessing', () => {
    // A newer build or a hand-edited backup. Guessing what an unknown id meant
    // would put invented answers in front of the user.
    const { state } = parseState({
      sessions: [],
      prefs: { unit: 'lb', gymProfile: { venue: 'spaceship', equipment: ['dumbbells', 'jetpack'] } },
    });

    expect(state.prefs.gymProfile?.venue).toBeUndefined();
    expect(state.prefs.gymProfile?.equipment).toEqual(['dumbbells']);
  });

  it('clamps implausible numbers', () => {
    const { state } = parseState({
      sessions: [],
      prefs: { unit: 'lb', gymProfile: { daysPerWeek: 99, sessionMinutes: 5000 } },
    });

    expect(state.prefs.gymProfile?.daysPerWeek).toBe(7);
    expect(state.prefs.gymProfile?.sessionMinutes).toBe(240);
  });

  it('survives nonsense', () => {
    for (const gymProfile of [null, 'text', 42, []]) {
      expect(() => parseState({ sessions: [], prefs: { unit: 'lb', gymProfile } })).not.toThrow();
    }
  });
});
