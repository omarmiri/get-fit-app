import { describe, expect, it } from 'vitest';

import { ALL_STATIONS, ZONE_LABEL, getStation } from '@/data/equipment';
import { ALL_EXERCISES } from '@/data/exercises';
import { DAY_KEYS, PLAN } from '@/data/plan';

/**
 * Guards on the equipment data.
 *
 * The catalogue names common gym equipment so the app can offer an alternative
 * when a machine is taken. It is not an inventory of any particular building,
 * so the tests that matter most keep it gym-agnostic and keep references from
 * dangling.
 */

describe('station catalogue', () => {
  it('has unique ids', () => {
    const ids = ALL_STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every station a zone with a human label', () => {
    for (const station of ALL_STATIONS) {
      expect(ZONE_LABEL[station.zone], station.id).toBeTruthy();
    }
  });

  it('names no gym chain, operator or brand', () => {
    /*
     * The catalogue is a vocabulary of common gym equipment, not a description
     * of one building. This guard is what keeps it that way: an earlier version
     * asserted a specific club's amenities and a specific manufacturer lineup,
     * which quietly made the app unusable to anyone training somewhere else.
     */
    const corpus = ALL_STATIONS.map((s) => `${s.name} ${s.note ?? ''}`)
      .join(' ')
      .toLowerCase();

    for (const brand of ['la fitness', 'life fitness', 'hammer strength', 'cybex', 'planet fitness']) {
      expect(corpus, `station catalogue names "${brand}"`).not.toContain(brand);
    }
  });

  it('resolves known ids and returns undefined for unknown ones', () => {
    expect(getStation('treadmill')?.name).toBe('Treadmill');
    expect(getStation('teleporter')).toBeUndefined();
  });
});

describe('exercise station references', () => {
  it('never points at a station that does not exist', () => {
    for (const exercise of ALL_EXERCISES) {
      for (const option of exercise.stations ?? []) {
        expect(getStation(option.stationId), `${exercise.id} -> ${option.stationId}`).toBeDefined();
      }
    }
  });

  it('gives every loaded movement at least one alternative to fall back on', () => {
    // The whole point of the feature: if the planned machine is taken, there
    // has to be somewhere else to go.
    for (const exercise of ALL_EXERCISES) {
      if (!exercise.loaded) continue;
      expect(exercise.stations?.length ?? 0, `${exercise.id} alternatives`).toBeGreaterThan(1);
    }
  });

  it('does not list the same station twice for one exercise', () => {
    for (const exercise of ALL_EXERCISES) {
      const ids = (exercise.stations ?? []).map((s) => s.stationId);
      expect(new Set(ids).size, exercise.id).toBe(ids.length);
    }
  });

  it('keeps load factors within a believable range', () => {
    for (const exercise of ALL_EXERCISES) {
      for (const option of exercise.stations ?? []) {
        if (option.loadFactor === undefined) continue;
        expect(option.loadFactor, `${exercise.id}/${option.stationId}`).toBeGreaterThanOrEqual(0);
        expect(option.loadFactor, `${exercise.id}/${option.stationId}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('leaves the primary station on its own scale', () => {
    // The head of the list is the reference, so converting it would be circular.
    for (const exercise of ALL_EXERCISES) {
      const primary = exercise.stations?.[0];
      if (!primary) continue;
      expect(primary.loadFactor, `${exercise.id} primary`).toBeUndefined();
    }
  });
});

describe('plan station references', () => {
  it('never points at a station that does not exist', () => {
    for (const key of DAY_KEYS) {
      const day = PLAN[key];
      for (const id of [...(day.modalityStations ?? []), ...(day.mobilityStations ?? [])]) {
        expect(getStation(id), `${key} -> ${id}`).toBeDefined();
      }
    }
  });

  it('offers more than one cardio option on every duration day', () => {
    for (const key of DAY_KEYS) {
      const day = PLAN[key];
      if (day.type === 'strength') continue;
      expect(day.modalityStations?.length ?? 0, `${key} cardio options`).toBeGreaterThan(1);
    }
  });

  it('sends pool days to the pool and gym days to the floor', () => {
    expect(PLAN.wed.modalityStations).toContain('poollaps');
    expect(PLAN.thu.modalityStations).toContain('uprightbike');
  });
});

