import type { DayKey, IsoDate } from '@/types';
import { DAY_KEYS } from '@/data/plan';

/**
 * Date handling.
 *
 * Everything here works in the device's local timezone deliberately. A training
 * session belongs to the calendar day the user experienced, not to a UTC
 * instant — logging at 11pm must not land on tomorrow. That means never using
 * `Date#toISOString()` to derive a date string, and never parsing `YYYY-MM-DD`
 * with `new Date(string)`, which the spec treats as UTC.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Format a `Date` as a local-timezone `YYYY-MM-DD` string. */
export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parse a local-timezone `YYYY-MM-DD` string into a `Date` at local midnight. */
export function parseIsoDate(value: IsoDate): Date {
  const [year = '0', month = '1', day = '1'] = value.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Whether a string is a well-formed calendar date.
 *
 * Checks the round trip rather than just the pattern, so `2025-02-30` — which
 * `Date` silently rolls forward to March 2nd — is rejected.
 */
export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

/** Today's date in the device's timezone. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** Which plan day today falls on. */
export function todayDayKey(now: Date = new Date()): DayKey {
  return dayKeyFor(now);
}

/**
 * The plan day a given date falls on.
 *
 * `getDay()` always returns 0-6 and `DAY_KEYS` has exactly seven entries, so
 * the fallback is unreachable — it is there to keep the return type honest
 * without a non-null assertion.
 */
export function dayKeyFor(date: Date): DayKey {
  return DAY_KEYS[date.getDay()] ?? 'sun';
}

/** A new `Date` offset by whole days. Does not mutate the input. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local midnight on the Sunday that starts the week containing `date`. */
export function startOfWeek(date: Date = new Date()): Date {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Short human date, e.g. `Mar 4`. Follows the device locale. */
export function formatShortDate(value: IsoDate): string {
  return parseIsoDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Longer human date, e.g. `Mon, Mar 4`. Used where the weekday matters. */
export function formatWithWeekday(value: IsoDate): string {
  return parseIsoDate(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Format a duration in seconds as `M:SS`. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
