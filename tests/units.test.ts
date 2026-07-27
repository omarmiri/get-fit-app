import { describe, expect, it } from 'vitest';

import type { LoggedSet } from '@/types';
import {
  convertWeight,
  formatVolume,
  formatWeight,
  formatWeightValue,
  isWeightUnit,
  roundForDisplay,
  setWeightIn,
} from '@/domain/units';
import { clampMinutes, clampReps, clampWeight } from '@/domain/limits';

describe('convertWeight', () => {
  it('returns the value untouched when the units match', () => {
    expect(convertWeight(45, 'lb', 'lb')).toBe(45);
  });

  it('converts both directions', () => {
    expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.462, 3);
    expect(convertWeight(220.462, 'lb', 'kg')).toBeCloseTo(100, 3);
  });

  it('round-trips without drift', () => {
    const original = 137.5;
    const round = convertWeight(convertWeight(original, 'lb', 'kg'), 'kg', 'lb');
    expect(round).toBeCloseTo(original, 9);
  });
});

describe('roundForDisplay', () => {
  it('rounds pounds to whole numbers', () => {
    expect(roundForDisplay(45.4, 'lb')).toBe(45);
    expect(roundForDisplay(45.6, 'lb')).toBe(46);
  });

  it('rounds kilograms to the nearest half, matching the smallest plate', () => {
    expect(roundForDisplay(20.3, 'kg')).toBe(20.5);
    expect(roundForDisplay(20.1, 'kg')).toBe(20);
  });
});

describe('setWeightIn', () => {
  const set = (weight: number, unit: 'lb' | 'kg'): LoggedSet => ({
    exerciseId: 'legpress',
    weight,
    unit,
    reps: 10,
    loggedAt: 0,
  });

  it('leaves a set alone when displayed in its own unit', () => {
    expect(setWeightIn(set(185, 'lb'), 'lb')).toBe(185);
  });

  it('converts a set logged in the other unit', () => {
    expect(setWeightIn(set(100, 'kg'), 'lb')).toBe(220);
    expect(setWeightIn(set(45, 'lb'), 'kg')).toBe(20.5);
  });

  it('survives a unit switch and back without shifting the stored value', () => {
    // This is the reason sets record their own unit rather than being
    // normalised on save: the number the user typed is never rewritten.
    const original = set(45, 'lb');
    expect(setWeightIn(original, 'kg')).toBe(20.5);
    expect(setWeightIn(original, 'lb')).toBe(45);
  });
});

describe('formatting', () => {
  it('drops a trailing .0 but keeps a real half', () => {
    expect(formatWeightValue(20, 'kg')).toBe('20');
    expect(formatWeightValue(20.5, 'kg')).toBe('20.5');
  });

  it('appends the unit', () => {
    expect(formatWeight(45, 'lb')).toBe('45 lb');
  });

  it('groups thousands in volume totals', () => {
    expect(formatVolume(12500, 'lb')).toMatch(/12[,. ]500 lb/);
  });
});

describe('isWeightUnit', () => {
  it('accepts only the two supported units', () => {
    expect(isWeightUnit('lb')).toBe(true);
    expect(isWeightUnit('kg')).toBe(true);
    expect(isWeightUnit('stone')).toBe(false);
    expect(isWeightUnit(undefined)).toBe(false);
  });
});

describe('input clamping', () => {
  it('coerces text from the number fields', () => {
    expect(clampWeight('185')).toBe(185);
    expect(clampReps('12')).toBe(12);
  });

  it('rejects nonsense rather than storing NaN', () => {
    expect(clampWeight('abc')).toBe(0);
    expect(clampReps(undefined)).toBe(0);
    expect(clampWeight(Number.NaN)).toBe(0);
    // Infinity can only come from a bug, never from typing, so it falls back to
    // the safe floor rather than being clamped up to the maximum.
    expect(clampWeight(Infinity)).toBe(0);
  });

  it('refuses negatives', () => {
    expect(clampWeight(-50)).toBe(0);
    expect(clampReps(-3)).toBe(0);
  });

  it('caps typos that would flatten every chart', () => {
    expect(clampWeight(500_000)).toBe(2000);
    expect(clampReps(10_000)).toBe(999);
    expect(clampMinutes(99_999)).toBe(480);
  });

  it('keeps fractional weights for 2.5 kg plates but rounds reps', () => {
    expect(clampWeight(22.5)).toBe(22.5);
    expect(clampReps(10.6)).toBe(11);
  });
});
