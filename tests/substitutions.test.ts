import { describe, expect, it } from 'vitest';

import type { Exercise, Preferences } from '@/types';
import { getBuiltinExercise } from '@/data/exercises';
import { getStation } from '@/data/equipment';
import { DEFAULT_PREFERENCES } from '@/state/schema';
import {
  defaultStationId,
  resolveOptions,
  roundToUsableIncrement,
  suggestLoad,
} from '@/domain/substitutions';

function exercise(id: string): Exercise {
  const found = getBuiltinExercise(id);
  if (!found) throw new Error(`missing fixture exercise: ${id}`);
  return found;
}

const prefs = (overrides: Partial<Preferences> = {}): Preferences => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});

describe('resolveOptions', () => {
  it('puts the planned station first', () => {
    const options = resolveOptions(exercise('legpress'), prefs(), 200, 'lb');
    expect(options[0]?.station.id).toBe('legpressmachine');
    expect(options[0]?.isPrimary).toBe(true);
  });

  it('offers real alternatives for a busy machine', () => {
    const options = resolveOptions(exercise('chestpress'), prefs(), 100, 'lb');
    const ids = options.map((o) => o.station.id);

    expect(ids).toContain('dumbbells');
    expect(ids).toContain('smithmachine');
    expect(ids.length).toBeGreaterThan(2);
  });

  it('resolves every station id to a real catalogue entry', () => {
    const options = resolveOptions(exercise('rdl'), prefs(), 50, 'lb');
    for (const option of options) {
      expect(getStation(option.station.id), option.station.id).toBeDefined();
    }
  });

  it('sinks stations marked missing from the club, without removing them', () => {
    // The catalogue is inferred, so flagging has to stay reversible.
    const options = resolveOptions(
      exercise('chestpress'),
      prefs({ missingStations: ['chestpressmachine'] }),
      100,
      'lb',
    );

    expect(options.map((o) => o.station.id)).toContain('chestpressmachine');
    expect(options.at(-1)?.station.id).toBe('chestpressmachine');
    expect(options[0]?.missing).toBe(false);
  });

  it('floats a remembered preference to the top', () => {
    const options = resolveOptions(
      exercise('chestpress'),
      prefs({ preferredStations: { chestpress: 'dumbbells' } }),
      100,
      'lb',
    );

    expect(options[0]?.station.id).toBe('dumbbells');
  });

  it('returns nothing for an exercise with no station options', () => {
    const bare: Exercise = { ...exercise('plank'), stations: [] };
    expect(resolveOptions(bare, prefs(), null, 'lb')).toEqual([]);
  });

  it('labels how the number on each station should be read', () => {
    const options = resolveOptions(exercise('chestpress'), prefs(), 100, 'lb');
    const byId = new Map(options.map((o) => [o.station.id, o]));

    expect(byId.get('dumbbells')?.loadBasis).toBe('per hand');
    // Hammer Strength iso-lateral is plate-loaded, so the plates are per side.
    expect(byId.get('isochestpress')?.loadBasis).toBe('per side');
    expect(byId.get('chestpressmachine')?.loadBasis).toBe('total');
  });
});

describe('suggestLoad', () => {
  it('carries the load unchanged when no factor is given', () => {
    expect(suggestLoad(200, { stationId: 'x' }, 'lb')).toBe(200);
  });

  it('scales down for a harder variant', () => {
    // Hack squat at 0.6 of a 200 lb leg press, rounded to the plate grid.
    expect(suggestLoad(200, { stationId: 'hacksquat', loadFactor: 0.6 }, 'lb')).toBe(120);
  });

  it('scales dumbbells to a per-hand number', () => {
    expect(suggestLoad(100, { stationId: 'dumbbells', loadFactor: 0.35, perHand: true }, 'lb')).toBe(35);
  });

  it('returns zero for a bodyweight substitute', () => {
    expect(suggestLoad(100, { stationId: 'mat', loadFactor: 0 }, 'lb')).toBe(0);
  });

  it('has nothing to suggest without a reference load', () => {
    expect(suggestLoad(null, { stationId: 'dumbbells' }, 'lb')).toBeNull();
    expect(suggestLoad(0, { stationId: 'dumbbells' }, 'lb')).toBeNull();
  });

  it('rounds to a weight you can actually assemble', () => {
    // 137 x 0.35 = 47.95, which is not a dumbbell that exists.
    const suggested = suggestLoad(137, { stationId: 'dumbbells', loadFactor: 0.35 }, 'lb');
    expect(suggested).toBe(50);
  });
});

describe('roundToUsableIncrement', () => {
  it('snaps pounds to the nearest 5', () => {
    expect(roundToUsableIncrement(63, 'lb')).toBe(65);
    expect(roundToUsableIncrement(61, 'lb')).toBe(60);
  });

  it('snaps kilograms to the nearest 2.5, matching the smallest plate', () => {
    expect(roundToUsableIncrement(28.4, 'kg')).toBe(27.5);
    expect(roundToUsableIncrement(29, 'kg')).toBe(30);
  });
});

describe('defaultStationId', () => {
  it('opens on the planned station', () => {
    expect(defaultStationId(exercise('legpress'), prefs())).toBe('legpressmachine');
  });

  it('skips a station the club does not have', () => {
    const chosen = defaultStationId(exercise('legpress'), prefs({ missingStations: ['legpressmachine'] }));
    expect(chosen).toBe('hacksquat');
  });

  it('honours a remembered preference over the plan', () => {
    const chosen = defaultStationId(
      exercise('legpress'),
      prefs({ preferredStations: { legpress: 'smithmachine' } }),
    );
    expect(chosen).toBe('smithmachine');
  });

  it('ignores a remembered preference the exercise cannot use', () => {
    const chosen = defaultStationId(
      exercise('legpress'),
      prefs({ preferredStations: { legpress: 'treadmill' } }),
    );
    expect(chosen).toBe('legpressmachine');
  });

  it('falls back to the plan when every station is marked missing', () => {
    const all = (exercise('legpress').stations ?? []).map((s) => s.stationId);
    expect(defaultStationId(exercise('legpress'), prefs({ missingStations: all }))).toBe('legpressmachine');
  });

  it('is undefined for an exercise with no stations', () => {
    const bare: Exercise = { ...exercise('plank'), stations: [] };
    expect(defaultStationId(bare, prefs())).toBeUndefined();
  });
});
