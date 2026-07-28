import { describe, expect, it } from 'vitest';

// Plain JS server module, typed by keepalive.d.ts.
import { isWithinWakeWindow, newYorkHour } from '../keepalive.js';

/**
 * The awake window.
 *
 * Worth testing because the failure is silent: a hardcoded UTC offset would
 * shift the whole window by an hour for the eight months of the year that New
 * York is on daylight time, and nothing would report it — the service would
 * simply be asleep at 8am and awake at 9pm.
 */

/** A UTC instant, for expressing "what is the clock doing in New York then". */
const utc = (iso: string): Date => new Date(iso);

describe('newYorkHour', () => {
  it('applies the -4 offset during daylight time', () => {
    // 2026-07-15 is EDT.
    expect(newYorkHour(utc('2026-07-15T12:00:00Z'))).toBe(8);
    expect(newYorkHour(utc('2026-07-15T16:30:00Z'))).toBe(12);
  });

  it('applies the -5 offset during standard time', () => {
    // 2026-01-15 is EST — the same UTC hour is an hour earlier in New York.
    expect(newYorkHour(utc('2026-01-15T13:00:00Z'))).toBe(8);
    expect(newYorkHour(utc('2026-01-15T12:00:00Z'))).toBe(7);
  });

  it('reports midnight as 0 rather than 24', () => {
    // hourCycle h23 rather than hour12:false, which some ICU builds render as 24.
    expect(newYorkHour(utc('2026-07-15T04:00:00Z'))).toBe(0);
  });

  it('handles the wrap across UTC midnight', () => {
    // 01:30 UTC in January is 20:30 the previous evening in New York.
    expect(newYorkHour(utc('2026-01-16T01:30:00Z'))).toBe(20);
  });
});

describe('isWithinWakeWindow', () => {
  it('is awake through the working day in summer', () => {
    expect(isWithinWakeWindow(utc('2026-07-15T12:00:00Z'))).toBe(true); // 08:00
    expect(isWithinWakeWindow(utc('2026-07-15T20:00:00Z'))).toBe(true); // 16:00
    expect(isWithinWakeWindow(utc('2026-07-16T00:30:00Z'))).toBe(true); // 20:30
  });

  it('is awake through the working day in winter', () => {
    expect(isWithinWakeWindow(utc('2026-01-15T13:00:00Z'))).toBe(true); // 08:00
    expect(isWithinWakeWindow(utc('2026-01-16T01:30:00Z'))).toBe(true); // 20:30
  });

  it('sleeps overnight', () => {
    expect(isWithinWakeWindow(utc('2026-07-15T08:00:00Z'))).toBe(false); // 04:00
    expect(isWithinWakeWindow(utc('2026-07-16T03:00:00Z'))).toBe(false); // 23:00
    expect(isWithinWakeWindow(utc('2026-01-15T06:00:00Z'))).toBe(false); // 01:00
  });

  it('wakes at 8am and not at 7am, in both offsets', () => {
    // Summer: 11:00 UTC is 07:00 NY, 12:00 UTC is 08:00 NY.
    expect(isWithinWakeWindow(utc('2026-07-15T11:59:00Z'))).toBe(false);
    expect(isWithinWakeWindow(utc('2026-07-15T12:00:00Z'))).toBe(true);

    // Winter: the same boundary sits an hour later in UTC.
    expect(isWithinWakeWindow(utc('2026-01-15T12:59:00Z'))).toBe(false);
    expect(isWithinWakeWindow(utc('2026-01-15T13:00:00Z'))).toBe(true);
  });

  it('stays awake through the 8pm hour, then sleeps at 9pm', () => {
    // Inclusive of hour 20 so an 8pm session does not cold-start mid-workout.
    expect(isWithinWakeWindow(utc('2026-07-16T00:59:00Z'))).toBe(true); // 20:59
    expect(isWithinWakeWindow(utc('2026-07-16T01:00:00Z'))).toBe(false); // 21:00
  });

  it('covers every hour of a summer day exactly once', () => {
    // Guards against an off-by-one making the window wider or narrower than
    // the 13 hours it is meant to be.
    let awake = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const at = utc(`2026-07-15T${String(hour).padStart(2, '0')}:30:00Z`);
      if (isWithinWakeWindow(at)) awake += 1;
    }
    expect(awake).toBe(13);
  });
});
