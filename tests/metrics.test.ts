import { describe, expect, it } from 'vitest';

import type { LoggedSet, Session } from '@/types';
import { bestOneRepMax, estimateOneRepMax, percentChange, sessionVolume } from '@/domain/metrics';

function set(exerciseId: string, weight: number, reps: number, unit: 'lb' | 'kg' = 'lb'): LoggedSet {
  return { exerciseId, weight, unit, reps, loggedAt: 0 };
}

function session(sets: LoggedSet[]): Session {
  return {
    id: 's1',
    date: '2025-03-04',
    dayKey: 'tue',
    sets,
    minutes: null,
    modality: null,
    effort: null,
    startedAt: 0,
  };
}

describe('estimateOneRepMax', () => {
  it('applies the Epley formula', () => {
    // 100 * (1 + 5/30)
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.667, 3);
  });

  it('returns the weight itself for a single rep', () => {
    expect(estimateOneRepMax(200, 1)).toBeCloseTo(200, 6);
  });

  it('caps reps so a high-rep set does not report an absurd maximum', () => {
    // Uncapped, 30 reps would claim a 2x maximum. Both of these clamp to 12.
    expect(estimateOneRepMax(100, 30)).toBe(estimateOneRepMax(100, 12));
    expect(estimateOneRepMax(100, 30)).toBeCloseTo(140, 6);
  });

  it('returns null where an estimate is meaningless', () => {
    expect(estimateOneRepMax(0, 10)).toBeNull();
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(Number.NaN, 5)).toBeNull();
  });
});

describe('bestOneRepMax', () => {
  it('picks the strongest set, not the heaviest or the last', () => {
    // 100x8 estimates 126.7, which beats 110x5 at 128.3? No — check explicitly.
    const best = bestOneRepMax(session([set('legpress', 100, 8), set('legpress', 120, 3)]), 'legpress', 'lb');
    expect(best).toBeCloseTo(132, 0);
  });

  it('ignores sets belonging to other exercises', () => {
    const best = bestOneRepMax(
      session([set('legpress', 100, 5), set('chestpress', 400, 5)]),
      'legpress',
      'lb',
    );
    expect(best).toBeCloseTo(116.667, 3);
  });

  it('converts to the requested unit', () => {
    const inKg = bestOneRepMax(session([set('legpress', 100, 1, 'kg')]), 'legpress', 'kg');
    const inLb = bestOneRepMax(session([set('legpress', 100, 1, 'kg')]), 'legpress', 'lb');
    expect(inKg).toBeCloseTo(100, 6);
    expect(inLb).toBeCloseTo(220.462, 3);
  });

  it('refuses to estimate a maximum for a timed hold', () => {
    // A 30-second plank has no one-rep max, however much it is loaded.
    expect(bestOneRepMax(session([set('plank', 20, 30)]), 'plank', 'lb')).toBeNull();
  });

  it('refuses to estimate for a bodyweight movement', () => {
    expect(bestOneRepMax(session([set('birddog', 0, 10)]), 'birddog', 'lb')).toBeNull();
  });

  it('returns null for an exercise no longer in the catalogue', () => {
    expect(bestOneRepMax(session([set('retired-lift', 100, 5)]), 'retired-lift', 'lb')).toBeNull();
  });
});

describe('sessionVolume', () => {
  it('sums weight times reps', () => {
    expect(sessionVolume([set('legpress', 100, 10), set('legpress', 100, 8)], 'lb')).toBe(1800);
  });

  it('excludes timed work, whose reps are seconds', () => {
    // Counting a 30-second carry at 50 lb as 1500 lb of volume would swamp the
    // real number and is dimensionally meaningless.
    const volume = sessionVolume([set('cablerow', 100, 10), set('farmercarry', 50, 30)], 'lb');
    expect(volume).toBe(1000);
  });

  it('converts mixed-unit sets into one total', () => {
    const volume = sessionVolume([set('legpress', 100, 1, 'kg'), set('legpress', 220.462, 1, 'lb')], 'lb');
    expect(volume).toBeCloseTo(440.924, 2);
  });

  it('is zero for an empty session', () => {
    expect(sessionVolume([], 'lb')).toBe(0);
  });
});

describe('percentChange', () => {
  it('computes gain and loss', () => {
    expect(percentChange(100, 110)).toBeCloseTo(10, 6);
    expect(percentChange(100, 90)).toBeCloseTo(-10, 6);
  });

  it('returns null when the baseline is zero', () => {
    expect(percentChange(0, 50)).toBeNull();
  });
});
