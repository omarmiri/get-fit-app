import { describe, expect, it } from 'vitest';

import type { Exercise, LoggedSet, SetEffort, UserProfile } from '@/types';
import { getBuiltinExercise } from '@/data/exercises';
import {
  type PerformanceBlock,
  STAGNATION_SESSIONS,
  adjustAfterSet,
  hardestEffort,
  increaseFrom,
  isStalled,
  loadClassFor,
  rampJump,
  recommend,
  toPerformanceBlocks,
} from '@/domain/progression';
import { floorToIncrement, startingWeight } from '@/domain/startingWeights';

function exercise(id: string): Exercise {
  const found = getBuiltinExercise(id);
  if (!found) throw new Error(`missing fixture exercise: ${id}`);
  return found;
}

/** A past session: one weight, the reps hit, and how each set felt. */
function block(weight: number, reps: number[], efforts: (SetEffort | undefined)[] = []): PerformanceBlock {
  return { weight, unit: 'lb', reps, efforts };
}

// Leg press: 8–12 reps.
const LEG_PRESS = exercise('legpress');

describe('recommend — double progression', () => {
  it('adds a rep when below the top of the range', () => {
    const result = recommend(LEG_PRESS, [block(180, [10, 10, 10], ['right', 'right', 'right'])], 'lb', null);

    expect(result?.kind).toBe('add-reps');
    expect(result?.weight).toBe(180);
    expect(result?.reps).toBe(11);
  });

  it('adds weight and resets reps once the top of the range is reached', () => {
    const result = recommend(LEG_PRESS, [block(180, [12, 12, 12], ['right', 'right', 'right'])], 'lb', null);

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBeGreaterThan(180);
    expect(result?.reps).toBe(LEG_PRESS.repMin);
  });

  it('refuses to add weight when the top of the range was a fight', () => {
    // Reps are necessary but not sufficient — effort is the gate.
    const result = recommend(LEG_PRESS, [block(180, [12, 12, 12], ['right', 'right', 'hard'])], 'lb', null);

    expect(result?.kind).toBe('repeat');
    expect(result?.weight).toBe(180);
  });

  it('holds the load when a set below the range top felt hard', () => {
    const result = recommend(LEG_PRESS, [block(180, [9, 9], ['right', 'hard'])], 'lb', null);

    expect(result?.kind).toBe('repeat');
    expect(result?.weight).toBe(180);
    expect(result?.reps).toBe(9);
  });

  it('judges the session by its worst set, not its best', () => {
    // 12, 12, 8 means the last set fell apart — that is not top of range.
    const result = recommend(LEG_PRESS, [block(180, [12, 12, 8])], 'lb', null);

    expect(result?.kind).toBe('add-reps');
    expect(result?.weight).toBe(180);
  });

  it('progresses when effort was never reported', () => {
    // Effort is optional; an unreported session should not freeze progression.
    const result = recommend(LEG_PRESS, [block(180, [12, 12, 12])], 'lb', null);
    expect(result?.kind).toBe('add-weight');
  });

  it('mentions that it felt easy when it did', () => {
    const result = recommend(LEG_PRESS, [block(180, [12, 12, 12], ['easy', 'easy', 'easy'])], 'lb', null);
    expect(result?.reason).toMatch(/easy/i);
  });

  it('always explains itself', () => {
    const result = recommend(LEG_PRESS, [block(180, [10, 10, 10])], 'lb', null);
    expect(result?.reason.length).toBeGreaterThan(10);
  });
});

describe('recommend — stagnation', () => {
  const stalled = Array.from({ length: STAGNATION_SESSIONS }, () => block(180, [10, 10, 10]));

  it('calls a deload after repeating the same numbers', () => {
    const result = recommend(LEG_PRESS, stalled, 'lb', null);

    expect(result?.kind).toBe('deload');
    expect(result?.weight).toBeLessThan(180);
    expect(result?.reason).toMatch(/stuck/i);
  });

  it('does not call it early', () => {
    const result = recommend(LEG_PRESS, stalled.slice(0, STAGNATION_SESSIONS - 1), 'lb', null);
    expect(result?.kind).not.toBe('deload');
  });

  it('is not fooled by progress within the same weight', () => {
    const improving = [block(180, [8, 8]), block(180, [9, 9]), block(180, [10, 10])];
    expect(isStalled(improving, 'lb')).toBe(false);
  });

  it('is not fooled by a weight change', () => {
    const climbing = [block(170, [10]), block(180, [10]), block(190, [10])];
    expect(isStalled(climbing, 'lb')).toBe(false);
  });

  it('detects a stall across mixed units', () => {
    // 81.6 kg and 180 lb are the same weight.
    const mixed: PerformanceBlock[] = [
      { weight: 180, unit: 'lb', reps: [10], efforts: [] },
      { weight: 81.6466, unit: 'kg', reps: [10], efforts: [] },
      { weight: 180, unit: 'lb', reps: [10], efforts: [] },
    ];
    expect(isStalled(mixed, 'lb')).toBe(true);
  });
});

describe('recommend — first time', () => {
  it('uses the profile estimate when there is no history', () => {
    const result = recommend(LEG_PRESS, [], 'lb', 90);

    expect(result?.kind).toBe('opening');
    expect(result?.weight).toBe(90);
    expect(result?.reps).toBe(LEG_PRESS.repMin);
    expect(result?.reason).toMatch(/no history here/i);
  });

  it('says nothing at all without history or a profile', () => {
    expect(recommend(LEG_PRESS, [], 'lb', null)).toBeNull();
  });

  it('has nothing to say about timed movements', () => {
    // A plank progresses by duration, which the rep range already expresses.
    expect(recommend(exercise('plank'), [], 'lb', 50)).toBeNull();
    expect(recommend(exercise('farmercarry'), [block(50, [30])], 'lb', null)).toBeNull();
  });
});

describe('increaseFrom', () => {
  it('raises by roughly 5%, on the plate grid', () => {
    expect(increaseFrom(200, 'lb')).toBe(210);
  });

  it('never returns the same weight, however light', () => {
    // 5% of 20 lb rounds back to 20; the floor is one usable increment.
    expect(increaseFrom(20, 'lb')).toBeGreaterThan(20);
    expect(increaseFrom(10, 'kg')).toBeGreaterThan(10);
  });
});

describe('hardestEffort', () => {
  it('reports the most demanding set of the session', () => {
    expect(hardestEffort(['easy', 'right', 'hard'])).toBe('hard');
    expect(hardestEffort(['easy', 'right'])).toBe('right');
    expect(hardestEffort(['easy'])).toBe('easy');
  });

  it('is undefined when nothing was reported', () => {
    expect(hardestEffort([undefined, undefined])).toBeUndefined();
    expect(hardestEffort([])).toBeUndefined();
  });
});

describe('toPerformanceBlocks', () => {
  const set = (weight: number, reps: number, effort?: SetEffort): LoggedSet => ({
    exerciseId: 'legpress',
    weight,
    unit: 'lb',
    reps,
    loggedAt: 0,
    ...(effort ? { effort } : {}),
  });

  it('groups sets by session date, oldest first', () => {
    const blocks = toPerformanceBlocks([
      { date: '2025-03-06', set: set(190, 8) },
      { date: '2025-03-04', set: set(180, 10) },
      { date: '2025-03-04', set: set(180, 9) },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.weight).toBe(180);
    expect(blocks[0]?.reps).toEqual([10, 9]);
    expect(blocks[1]?.weight).toBe(190);
  });

  it('keeps the working weight and drops lighter warm-up sets', () => {
    const blocks = toPerformanceBlocks([
      { date: '2025-03-04', set: set(90, 12) },
      { date: '2025-03-04', set: set(180, 10) },
      { date: '2025-03-04', set: set(180, 9) },
    ]);

    expect(blocks[0]?.weight).toBe(180);
    expect(blocks[0]?.reps).toEqual([10, 9]);
  });

  it('carries effort through', () => {
    const blocks = toPerformanceBlocks([{ date: '2025-03-04', set: set(180, 10, 'hard') }]);
    expect(blocks[0]?.efforts).toEqual(['hard']);
  });

  it('is empty for no input', () => {
    expect(toPerformanceBlocks([])).toEqual([]);
  });
});

describe('startingWeight', () => {
  const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
    age: 40,
    bodyweight: 200,
    bodyweightUnit: 'lb',
    level: 'new',
    recordedOn: '2025-03-04',
    ...overrides,
  });

  it('scales from bodyweight', () => {
    // Leg press factor is 0.50, so 200 lb bodyweight -> 100 lb.
    expect(startingWeight(LEG_PRESS, profile(), 'lb')).toBe(100);
  });

  it('suggests more for the experienced than the beginner', () => {
    const novice = startingWeight(LEG_PRESS, profile({ level: 'new' }), 'lb') ?? 0;
    const returning = startingWeight(LEG_PRESS, profile({ level: 'returning' }), 'lb') ?? 0;
    const experienced = startingWeight(LEG_PRESS, profile({ level: 'experienced' }), 'lb') ?? 0;

    expect(returning).toBeGreaterThan(novice);
    expect(experienced).toBeGreaterThan(returning);
  });

  it('tapers above 50 but not below it', () => {
    const forty = startingWeight(LEG_PRESS, profile({ age: 40 }), 'lb') ?? 0;
    const fifty = startingWeight(LEG_PRESS, profile({ age: 50 }), 'lb') ?? 0;
    const seventy = startingWeight(LEG_PRESS, profile({ age: 70 }), 'lb') ?? 0;

    expect(fifty).toBe(forty);
    expect(seventy).toBeLessThan(forty);
  });

  it('errs light — the estimate never exceeds the raw ratio', () => {
    // Rounding down is a safety decision, not a cosmetic one.
    const suggested = startingWeight(LEG_PRESS, profile({ bodyweight: 187 }), 'lb') ?? 0;
    expect(suggested).toBeLessThanOrEqual(187 * 0.5);
  });

  it('converts bodyweight recorded in another unit', () => {
    const inKg = startingWeight(LEG_PRESS, profile({ bodyweight: 90, bodyweightUnit: 'kg' }), 'lb') ?? 0;
    // 90 kg is about 198 lb, so about 99 lb at a 0.5 factor.
    expect(inKg).toBeGreaterThan(90);
    expect(inKg).toBeLessThanOrEqual(100);
  });

  it('applies the station conversion so dumbbells come out per hand', () => {
    const machine = startingWeight(exercise('chestpress'), profile(), 'lb') ?? 0;
    const dumbbells =
      startingWeight(exercise('chestpress'), profile(), 'lb', { stationId: 'dumbbells', loadFactor: 0.35 }) ??
      0;

    expect(dumbbells).toBeLessThan(machine);
  });

  it('has nothing to suggest without a profile', () => {
    expect(startingWeight(LEG_PRESS, undefined, 'lb')).toBeNull();
  });

  it('has nothing to suggest for a bodyweight movement', () => {
    expect(startingWeight(exercise('plank'), profile(), 'lb')).toBeNull();
    expect(startingWeight(exercise('birddog'), profile(), 'lb')).toBeNull();
  });

  it('refuses a nonsensical bodyweight rather than guessing', () => {
    expect(startingWeight(LEG_PRESS, profile({ bodyweight: 0 }), 'lb')).toBeNull();
  });
});

describe('floorToIncrement', () => {
  it('rounds down, never up', () => {
    expect(floorToIncrement(97, 'lb')).toBe(95);
    expect(floorToIncrement(99.9, 'lb')).toBe(95);
    expect(floorToIncrement(100, 'lb')).toBe(100);
  });

  it('uses the 2.5 kg plate grid', () => {
    expect(floorToIncrement(44, 'kg')).toBe(42.5);
  });

  it('never goes negative', () => {
    expect(floorToIncrement(-10, 'lb')).toBe(0);
  });
});

describe('loadClassFor', () => {
  it('treats big lower-body lifts as the largest jump', () => {
    expect(loadClassFor(LEG_PRESS)).toBe('lower');
    expect(loadClassFor(exercise('rdl'))).toBe('lower');
    expect(loadClassFor(exercise('splitsquat'))).toBe('lower');
  });

  it('treats compound upper-body presses and pulls as the middle jump', () => {
    expect(loadClassFor(exercise('chestpress'))).toBe('upper');
    expect(loadClassFor(exercise('seatedrow'))).toBe('upper');
    expect(loadClassFor(exercise('shoulderpress'))).toBe('upper');
  });

  it('only calls a movement small when every muscle it lists is small', () => {
    expect(loadClassFor(exercise('lateralraise'))).toBe('small');
    // A row lists biceps, but it is not an isolation movement.
    expect(loadClassFor(exercise('latpulldown'))).toBe('upper');
  });

  it('falls back to the middle tier when an exercise lists no muscles', () => {
    const { muscles: _muscles, ...bare } = LEG_PRESS;
    expect(loadClassFor(bare)).toBe('upper');
  });
});

describe('rampJump', () => {
  it('gives a set that felt easy the full jump for its class', () => {
    expect(rampJump(LEG_PRESS, 'easy', 'lb')).toBe(20);
    expect(rampJump(exercise('seatedrow'), 'easy', 'lb')).toBe(10);
    expect(rampJump(exercise('lateralraise'), 'easy', 'lb')).toBe(5);
  });

  it('gives a set that was on target half the jump', () => {
    expect(rampJump(LEG_PRESS, 'right', 'lb')).toBe(10);
    expect(rampJump(exercise('seatedrow'), 'right', 'lb')).toBe(5);
  });

  it('never goes below one loadable increment', () => {
    expect(rampJump(exercise('lateralraise'), 'right', 'lb')).toBe(5);
    expect(rampJump(exercise('lateralraise'), 'right', 'kg')).toBe(2.5);
  });

  it('gives a hard set nothing', () => {
    expect(rampJump(LEG_PRESS, 'hard', 'lb')).toBe(0);
  });

  it('uses metric jumps in kilograms', () => {
    expect(rampJump(LEG_PRESS, 'easy', 'kg')).toBe(10);
    expect(rampJump(exercise('seatedrow'), 'easy', 'kg')).toBe(5);
  });
});

describe('adjustAfterSet — ramping inside a session', () => {
  it('adds the full jump after an easy set', () => {
    const result = adjustAfterSet(LEG_PRESS, 180, 'easy', 'lb');

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBe(200);
    expect(result?.delta).toBe(20);
  });

  it('adds half the jump after a set that was on target', () => {
    const result = adjustAfterSet(LEG_PRESS, 180, 'right', 'lb');

    expect(result?.kind).toBe('add-weight');
    expect(result?.weight).toBe(190);
  });

  it('holds the weight after a hard set', () => {
    const result = adjustAfterSet(LEG_PRESS, 180, 'hard', 'lb');

    expect(result?.kind).toBe('repeat');
    expect(result?.weight).toBe(180);
    expect(result?.delta).toBe(0);
  });

  it('says nothing when the set was logged without an effort report', () => {
    expect(adjustAfterSet(LEG_PRESS, 180, undefined, 'lb')).toBeNull();
  });

  it('says nothing for a timed hold', () => {
    expect(adjustAfterSet(exercise('plank'), 0, 'easy', 'lb')).toBeNull();
  });

  it('says nothing when there is no load to scale from', () => {
    expect(adjustAfterSet(LEG_PRESS, 0, 'easy', 'lb')).toBeNull();
  });

  it('holds rather than pretending to add at the top of the clamp', () => {
    const result = adjustAfterSet(LEG_PRESS, 2000, 'easy', 'lb');

    expect(result?.kind).toBe('repeat');
    expect(result?.weight).toBe(2000);
  });

  it('names the new weight in the reason, so the card explains itself', () => {
    expect(adjustAfterSet(LEG_PRESS, 180, 'easy', 'lb')?.reason).toContain('200 lb');
  });
});
