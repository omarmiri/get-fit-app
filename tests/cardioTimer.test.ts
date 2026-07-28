import { describe, expect, it } from 'vitest';

import type { CardioTimerState } from '@/ui/components/cardioTimer';
import { elapsedMinutes, elapsedMs, hasReachedTarget } from '@/ui/components/cardioTimer';

/**
 * Run-clock arithmetic.
 *
 * The property that matters: paused time must never count toward the session.
 * Stepping off for water or waiting for a machine is normal, and a clock that
 * bills you for it would make the logged duration a lie.
 */

const START = 1_700_000_000_000;

function state(overrides: Partial<CardioTimerState> = {}): CardioTimerState {
  return {
    targetSeconds: 45 * 60,
    accumulatedMs: 0,
    startedAt: START,
    ...overrides,
  };
}

describe('elapsedMs', () => {
  it('counts time since the clock started', () => {
    expect(elapsedMs(state(), START + 60_000)).toBe(60_000);
  });

  it('freezes while paused', () => {
    // Ten minutes banked, then paused. Time passing changes nothing.
    const paused = state({ accumulatedMs: 600_000, startedAt: null });

    expect(elapsedMs(paused, START)).toBe(600_000);
    expect(elapsedMs(paused, START + 3_600_000)).toBe(600_000);
  });

  it('adds a resumed segment to what was already banked', () => {
    const resumed = state({ accumulatedMs: 600_000, startedAt: START });
    expect(elapsedMs(resumed, START + 300_000)).toBe(900_000);
  });

  it('is zero at the instant it starts', () => {
    expect(elapsedMs(state(), START)).toBe(0);
  });

  it('keeps time across a long backgrounded stretch', () => {
    // The screen is off for most of a 45 minute run; a decrementing counter
    // would be throttled, a timestamp difference is not.
    expect(elapsedMs(state(), START + 45 * 60_000)).toBe(2_700_000);
  });
});

describe('elapsedMinutes', () => {
  it('rounds to the nearest minute', () => {
    expect(elapsedMinutes(state(), START + 89_000)).toBe(1);
    expect(elapsedMinutes(state(), START + 91_000)).toBe(2);
  });

  it('never reports negative time', () => {
    // A clock skew backwards should log zero, not a negative session.
    expect(elapsedMinutes(state(), START - 60_000)).toBe(0);
  });

  it('reports the real duration of a paused-and-resumed session', () => {
    // 20 minutes run, a long pause, then 10 more. The pause must not count.
    const banked = state({ accumulatedMs: 20 * 60_000, startedAt: START });
    expect(elapsedMinutes(banked, START + 10 * 60_000)).toBe(30);
  });
});

describe('hasReachedTarget', () => {
  it('is false before the planned time', () => {
    expect(hasReachedTarget(state(), START + 44 * 60_000)).toBe(false);
  });

  it('is true at and past the planned time', () => {
    expect(hasReachedTarget(state(), START + 45 * 60_000)).toBe(true);
    expect(hasReachedTarget(state(), START + 60 * 60_000)).toBe(true);
  });

  it('does not tick over while paused short of the target', () => {
    const paused = state({ accumulatedMs: 44 * 60_000, startedAt: null });
    expect(hasReachedTarget(paused, START + 3_600_000)).toBe(false);
  });
});
