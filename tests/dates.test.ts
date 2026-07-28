import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  formatClock,
  formatDuration,
  formatElapsed,
  isValidIsoDate,
  parseIsoDate,
  startOfWeek,
  toIsoDate,
  todayDayKey,
} from '@/domain/dates';

describe('toIsoDate', () => {
  it('formats in local time, not UTC', () => {
    // Late-evening local times are the case that breaks a toISOString()-based
    // implementation: it would roll this forward to the next day.
    const lateEvening = new Date(2025, 2, 4, 23, 30);
    expect(toIsoDate(lateEvening)).toBe('2025-03-04');
  });

  it('zero-pads month and day', () => {
    expect(toIsoDate(new Date(2025, 0, 5))).toBe('2025-01-05');
  });
});

describe('parseIsoDate', () => {
  it('round-trips with toIsoDate', () => {
    expect(toIsoDate(parseIsoDate('2025-11-09'))).toBe('2025-11-09');
  });

  it('produces a local midnight, not a UTC instant', () => {
    const parsed = parseIsoDate('2025-06-15');
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getDate()).toBe(15);
    expect(parsed.getMonth()).toBe(5);
  });
});

describe('isValidIsoDate', () => {
  it('accepts real dates', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    // Date would silently roll this to March 2nd.
    expect(isValidIsoDate('2025-02-30')).toBe(false);
    expect(isValidIsoDate('2025-13-01')).toBe(false);
  });

  it('rejects malformed and non-string input', () => {
    expect(isValidIsoDate('2025-3-4')).toBe(false);
    expect(isValidIsoDate('not a date')).toBe(false);
    expect(isValidIsoDate(20250304)).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });
});

describe('startOfWeek', () => {
  it('returns the preceding Sunday at midnight', () => {
    // 2025-03-05 is a Wednesday.
    const start = startOfWeek(new Date(2025, 2, 5, 14, 22));
    expect(toIsoDate(start)).toBe('2025-03-02');
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });

  it('is a no-op on a Sunday other than clearing the time', () => {
    const start = startOfWeek(new Date(2025, 2, 2, 23, 59));
    expect(toIsoDate(start)).toBe('2025-03-02');
  });

  it('does not mutate its argument', () => {
    const input = new Date(2025, 2, 5, 14, 22);
    startOfWeek(input);
    expect(input.getDate()).toBe(5);
    expect(input.getHours()).toBe(14);
  });
});

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(toIsoDate(addDays(new Date(2025, 0, 30), 3))).toBe('2025-02-02');
  });

  it('goes backwards and does not mutate', () => {
    const input = new Date(2025, 0, 2);
    expect(toIsoDate(addDays(input, -3))).toBe('2024-12-30');
    expect(toIsoDate(input)).toBe('2025-01-02');
  });
});

describe('daysBetween', () => {
  it('counts whole days across a DST boundary', () => {
    // US DST begins 2025-03-09; a naive ms/86400000 would give 6.958 -> 6.
    expect(daysBetween('2025-03-06', '2025-03-13')).toBe(7);
  });

  it('is negative when the target is earlier', () => {
    expect(daysBetween('2025-03-13', '2025-03-06')).toBe(-7);
  });
});

describe('todayDayKey', () => {
  it('maps weekdays to plan keys', () => {
    expect(todayDayKey(new Date(2025, 2, 2))).toBe('sun');
    expect(todayDayKey(new Date(2025, 2, 5))).toBe('wed');
    expect(todayDayKey(new Date(2025, 2, 8))).toBe('sat');
  });
});

describe('formatClock', () => {
  it('pads seconds', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('floors at zero rather than showing negative time', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('formatElapsed', () => {
  it('reads as M:SS below an hour, like the other timers', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(3599)).toBe('59:59');
  });

  it('rolls over to H:MM:SS rather than showing 74:12', () => {
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(4452)).toBe('1:14:12');
  });

  it('never goes negative', () => {
    expect(formatElapsed(-90)).toBe('0:00');
  });
});

describe('formatDuration', () => {
  it('reads in minutes under an hour', () => {
    expect(formatDuration(48)).toBe('48 min');
    expect(formatDuration(0)).toBe('0 min');
  });

  it('splits into hours and padded minutes past an hour', () => {
    expect(formatDuration(60)).toBe('1h 00m');
    expect(formatDuration(74)).toBe('1h 14m');
    expect(formatDuration(125)).toBe('2h 05m');
  });

  it('never goes negative', () => {
    expect(formatDuration(-5)).toBe('0 min');
  });
});
