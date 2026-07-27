import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, parseState, parseStateJson } from '@/state/schema';

/**
 * The v0.1 shape, reproduced verbatim. These are the objects sitting in real
 * users' `localStorage` right now, so this fixture must not be "tidied up".
 */
const LEGACY_STATE = {
  sessions: [
    {
      id: 's1700000000000',
      date: '2025-03-04',
      dayKey: 'tue',
      sets: [
        { ex: 'legpress', w: 180, r: 10, ts: 1_700_000_000_000 },
        { ex: 'hamstring', w: 40, r: 12, ts: 1_700_000_100_000 },
      ],
      minutes: null,
      modality: null,
      rpe: null,
      started: 1_700_000_000_000,
    },
    {
      date: '2025-03-05',
      dayKey: 'wed',
      sets: [],
      minutes: 35,
      modality: 'Easy laps',
      rpe: 'Easy',
      started: 1_700_100_000_000,
    },
  ],
  active: null,
  prefs: { trend: 'legpress' },
};

describe('parseState — v1 migration', () => {
  it('renames the legacy set fields', () => {
    const { state } = parseState(LEGACY_STATE);
    const first = state.sessions[0]?.sets[0];

    expect(first).toMatchObject({ exerciseId: 'legpress', weight: 180, reps: 10 });
    expect(first?.loggedAt).toBe(1_700_000_000_000);
  });

  it('assumes pounds for sets logged before units were recorded', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.sessions[0]?.sets[0]?.unit).toBe('lb');
  });

  it('remaps the renamed hamstring exercise id so history is not orphaned', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.sessions[0]?.sets[1]?.exerciseId).toBe('glutebridge');
  });

  it('renames rpe to effort', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.sessions[1]?.effort).toBe('Easy');
  });

  it('carries over the trend preference under its new key', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.prefs.trendExerciseId).toBe('legpress');
  });

  it('defaults the unit preference to pounds', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.prefs.unit).toBe('lb');
  });

  it('backfills an id for sessions that never had one', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.sessions[1]?.id).toBeTruthy();
  });

  it('stamps the current schema version', () => {
    const { state } = parseState(LEGACY_STATE);
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('preserves every session', () => {
    const { state, dropped } = parseState(LEGACY_STATE);
    expect(state.sessions).toHaveLength(2);
    expect(dropped).toBe(0);
  });
});

describe('parseState — robustness', () => {
  it('never throws on hostile input', () => {
    for (const input of [null, undefined, 42, 'text', [], {}, { sessions: 'no' }]) {
      expect(() => parseState(input)).not.toThrow();
    }
  });

  it('reports unrecognised data rather than inventing an empty log', () => {
    expect(parseState({ nope: true }).recognised).toBe(false);
    expect(parseState({ sessions: [] }).recognised).toBe(true);
  });

  it('drops individual bad sessions instead of failing the whole load', () => {
    const { state, dropped } = parseState({
      sessions: [
        { date: '2025-03-04', dayKey: 'tue', sets: [] },
        { date: 'not-a-date', dayKey: 'tue', sets: [] },
        { date: '2025-03-05', dayKey: 'notaday', sets: [] },
        null,
      ],
    });

    expect(state.sessions).toHaveLength(1);
    expect(dropped).toBe(3);
  });

  it('drops malformed sets but keeps the session around them', () => {
    const { state } = parseState({
      sessions: [
        {
          date: '2025-03-04',
          dayKey: 'tue',
          sets: [{ ex: 'legpress', w: 100, r: 5 }, { w: 100, r: 5 }, 'garbage'],
        },
      ],
    });

    expect(state.sessions[0]?.sets).toHaveLength(1);
  });

  it('clamps out-of-range values rather than trusting them', () => {
    const { state } = parseState({
      sessions: [
        {
          date: '2025-03-04',
          dayKey: 'tue',
          minutes: 99_999,
          sets: [{ ex: 'legpress', w: -50, r: 999_999 }],
        },
      ],
    });

    expect(state.sessions[0]?.minutes).toBe(480);
    expect(state.sessions[0]?.sets[0]?.weight).toBe(0);
    expect(state.sessions[0]?.sets[0]?.reps).toBe(999);
  });

  it('sorts sessions oldest first regardless of stored order', () => {
    const { state } = parseState({
      sessions: [
        { date: '2025-03-09', dayKey: 'sun', sets: [] },
        { date: '2025-03-04', dayKey: 'tue', sets: [] },
        { date: '2025-03-06', dayKey: 'thu', sets: [] },
      ],
    });

    expect(state.sessions.map((s) => s.date)).toEqual(['2025-03-04', '2025-03-06', '2025-03-09']);
  });

  it('ignores an unknown weight unit rather than storing it', () => {
    const { state } = parseState({
      sessions: [
        { date: '2025-03-04', dayKey: 'tue', sets: [{ ex: 'legpress', w: 100, r: 5, unit: 'stone' }] },
      ],
    });

    expect(state.sessions[0]?.sets[0]?.unit).toBe('lb');
  });

  it('keeps a valid kilogram unit', () => {
    const { state } = parseState({
      sessions: [
        {
          date: '2025-03-04',
          dayKey: 'tue',
          sets: [{ exerciseId: 'legpress', weight: 60, reps: 5, unit: 'kg' }],
        },
      ],
    });

    expect(state.sessions[0]?.sets[0]).toMatchObject({ unit: 'kg', weight: 60 });
  });
});

describe('parseState — stations (v3)', () => {
  it('keeps the station a set was performed on', () => {
    const { state } = parseState({
      sessions: [
        {
          date: '2025-03-04',
          dayKey: 'tue',
          sets: [{ exerciseId: 'legpress', weight: 200, reps: 8, unit: 'lb', stationId: 'hacksquat' }],
        },
      ],
    });

    expect(state.sessions[0]?.sets[0]?.stationId).toBe('hacksquat');
  });

  it('leaves pre-station sets without one rather than inventing it', () => {
    // Back-filling would put fabricated data into the user's history.
    const { state } = parseState({
      sessions: [{ date: '2025-03-04', dayKey: 'tue', sets: [{ ex: 'legpress', w: 200, r: 8 }] }],
    });

    expect(state.sessions[0]?.sets[0]?.stationId).toBeUndefined();
  });

  it('round-trips the missing-equipment list', () => {
    const { state } = parseState({
      sessions: [],
      prefs: { missingStations: ['hacksquat', 'rower'] },
    });

    expect(state.prefs.missingStations).toEqual(['hacksquat', 'rower']);
  });

  it('drops non-string entries from the missing list', () => {
    const { state } = parseState({
      sessions: [],
      prefs: { missingStations: ['hacksquat', 42, null, ''] },
    });

    expect(state.prefs.missingStations).toEqual(['hacksquat']);
  });

  it('round-trips per-exercise station preferences', () => {
    const { state } = parseState({
      sessions: [],
      prefs: { preferredStations: { legpress: 'smithmachine' } },
    });

    expect(state.prefs.preferredStations).toEqual({ legpress: 'smithmachine' });
  });

  it('applies the exercise id rename to station preferences too', () => {
    const { state } = parseState({
      sessions: [],
      prefs: { preferredStations: { hamstring: 'lyinglegcurl' } },
    });

    expect(state.prefs.preferredStations).toEqual({ glutebridge: 'lyinglegcurl' });
  });

  it('omits the station keys entirely when there is nothing to store', () => {
    const { state } = parseState({ sessions: [] });
    expect(state.prefs.missingStations).toBeUndefined();
    expect(state.prefs.preferredStations).toBeUndefined();
  });
});

describe('parseStateJson', () => {
  it('treats malformed JSON as unrecognised instead of throwing', () => {
    const result = parseStateJson('{ not json');
    expect(result.recognised).toBe(false);
    expect(result.state.sessions).toEqual([]);
  });

  it('round-trips a parsed state', () => {
    const first = parseState(LEGACY_STATE).state;
    const second = parseStateJson(JSON.stringify(first)).state;
    expect(second.sessions).toEqual(first.sessions);
    expect(second.prefs).toEqual(first.prefs);
  });
});
