import { describe, expect, it } from 'vitest';

import type { Exercise } from '@/types';
import { getBuiltinExercise } from '@/data/exercises';
import type { PerformanceBlock } from '@/domain/progression';
import { adjustAfterSet, easierThan, harderThan, recommend } from '@/domain/progression';
import { startingWeight } from '@/domain/startingWeights';
import { parseCustomExercise } from '@/domain/planFormat';

/**
 * Movements where a bigger number means an easier set.
 *
 * Assisted pull-up and dip machines are counterweighted: the stack takes your
 * bodyweight off, so 80 lb is easier than 40 and progress is the number coming
 * down. Every piece of arithmetic in the app assumed the opposite, which meant
 * an easy set earned *more* assistance — the engine progressing someone
 * backwards, confidently, with a reason line explaining the increase.
 *
 * These tests pin the direction. It is the kind of bug that reads as correct
 * in the code and is only wrong against the world.
 */

const assisted: Exercise = {
  id: 'assistedpullup',
  name: 'Assisted pull-up',
  sets: 3,
  repRange: '6–10',
  repMin: 6,
  repMax: 10,
  defaultReps: 8,
  repMetric: 'reps',
  loaded: true,
  inverseLoad: true,
  restSeconds: 90,
  cues: { setup: 'Set the assist.', execute: 'Pull up.', avoid: 'Half reps.' },
};

const normal: Exercise = { ...assisted, id: 'legpress', name: 'Leg press', inverseLoad: false };

describe('harderThan / easierThan', () => {
  it('makes a barbell movement harder by adding weight', () => {
    expect(harderThan(normal, 100, 'lb')).toBeGreaterThan(100);
    expect(easierThan(normal, 100, 'lb')).toBeLessThan(100);
  });

  it('makes an assisted movement harder by removing assistance', () => {
    expect(harderThan(assisted, 100, 'lb')).toBeLessThan(100);
    expect(easierThan(assisted, 100, 'lb')).toBeGreaterThan(100);
  });

  it('never drives assistance below zero', () => {
    // Zero is a real destination, not a floor to guard against: no assistance
    // at all is an unassisted pull-up.
    expect(harderThan(assisted, 5, 'lb')).toBeGreaterThanOrEqual(0);
    expect(harderThan(assisted, 0, 'lb')).toBe(0);
  });
});

describe('the next session', () => {
  const blocks = (weight: number): PerformanceBlock[] => [
    { weight, unit: 'lb', reps: [10, 10, 10], efforts: ['easy'] },
  ];

  it('reduces assistance after an easy top-of-range session', () => {
    // The bug in one assertion. Before this, an easy set at 80 lb of assist
    // earned 85 — more help, for having found it easy.
    const result = recommend(assisted, blocks(80), 'lb', null);

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBeLessThan(80);
  });

  it('still adds weight for an ordinary movement', () => {
    const result = recommend(normal, blocks(100), 'lb', null);

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBeGreaterThan(100);
  });

  it('explains an assisted increase in the language of help, not load', () => {
    const result = recommend(assisted, blocks(80), 'lb', null);

    expect(result?.reason).toContain('assist');
    expect(result?.reason).not.toMatch(/Go to/);
  });

  it('deloads an assisted movement by giving more help', () => {
    // Stalled: three sessions at the same numbers.
    const stalled: PerformanceBlock[] = [80, 80, 80].map((weight) => ({
      weight,
      unit: 'lb',
      reps: [6, 6, 6],
      efforts: ['hard'],
    }));

    const result = recommend(assisted, stalled, 'lb', null);
    expect(result?.kind).toBe('deload');
    expect(result?.weight).toBeGreaterThan(80);
  });
});

describe('the next set within a session', () => {
  it('takes assistance away after an easy set', () => {
    const result = adjustAfterSet(assisted, 80, 'easy', 'lb');

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBeLessThan(80);
    expect(result?.delta).toBeLessThan(0);
    expect(result?.reason).toContain('less help');
  });

  it('adds weight after an easy set on an ordinary movement', () => {
    const result = adjustAfterSet(normal, 100, 'easy', 'lb');

    expect(result?.weight).toBeGreaterThan(100);
    expect(result?.delta).toBeGreaterThan(0);
  });

  it('holds after a hard set either way', () => {
    expect(adjustAfterSet(assisted, 80, 'hard', 'lb')?.delta).toBe(0);
    expect(adjustAfterSet(normal, 100, 'hard', 'lb')?.delta).toBe(0);
  });

  it('reports no change once assistance reaches zero', () => {
    expect(adjustAfterSet(assisted, 0, 'easy', 'lb')).toBeNull();
  });
});

describe('the opening estimate', () => {
  it('rounds an assisted suggestion up, not down', () => {
    /*
     * The subtle half of this bug. Everywhere else the app rounds *down*
     * because less weight is the safe mistake — but on an assisted machine
     * down means less help, so the rounding that protects a novice on a leg
     * press is the one that drops them onto an unassisted pull-up.
     */
    const opener = startingWeight({ ...assisted, openingWeight: { value: 82, unit: 'lb' } }, undefined, 'lb');
    expect(opener).toBe(85);
  });

  it('still rounds an ordinary suggestion down', () => {
    const opener = startingWeight({ ...normal, openingWeight: { value: 82, unit: 'lb' } }, undefined, 'lb');
    expect(opener).toBe(80);
  });
});

describe('plans and the catalogue', () => {
  it('carries inverseLoad through the parser', () => {
    const parsed = parseCustomExercise({
      name: 'Band-assisted pull-up',
      loaded: true,
      inverseLoad: true,
    });

    expect(parsed?.inverseLoad).toBe(true);
  });

  it('ignores it on an unloaded movement, where there is no number to invert', () => {
    const parsed = parseCustomExercise({ name: 'Plank', loaded: false, inverseLoad: true });

    expect(parsed?.inverseLoad).toBeUndefined();
  });

  it('ships assisted pull-up and dip as built-ins with the flag set', () => {
    // So a plan can reference them by id and inherit the direction, rather
    // than every author having to know to set it.
    expect(getBuiltinExercise('assistedpullup')?.inverseLoad).toBe(true);
    expect(getBuiltinExercise('assisteddip')?.inverseLoad).toBe(true);
  });

  it('leaves ordinary built-ins alone', () => {
    expect(getBuiltinExercise('legpress')?.inverseLoad).toBeUndefined();
  });
});
