import type { LoggedSet, WeightUnit } from '@/types';

/**
 * Weight units.
 *
 * Sets store the unit they were logged in rather than being normalised to a
 * canonical unit on save. That choice is deliberate: a user who logged `45 lb`
 * should still see `45 lb` after switching the app to kilograms and back, and
 * round-tripping through a canonical unit accumulates float drift and produces
 * numbers like `44.9`. Conversion happens only for display and aggregation.
 */

// One pound is exactly 0.45359237 kg by international definition; deriving
// the reciprocal avoids transcribing a literal that cannot be represented.
const KILOGRAMS_PER_POUND = 0.453_592_37;
const POUNDS_PER_KILOGRAM = 1 / KILOGRAMS_PER_POUND;

/** Increment used by the +/- steppers, chosen to match common plate jumps. */
export const STEP_BY_UNIT: Readonly<Record<WeightUnit, number>> = {
  lb: 5,
  kg: 2.5,
};

/** Display suffix. */
export const UNIT_LABEL: Readonly<Record<WeightUnit, string>> = {
  lb: 'lb',
  kg: 'kg',
};

/** Whether a value is a unit the app supports. */
export function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

/** Convert a weight between units. Returns the input unchanged when units match. */
export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === 'kg' ? value * POUNDS_PER_KILOGRAM : value / POUNDS_PER_KILOGRAM;
}

/**
 * Round a converted weight to something a person would actually read.
 *
 * Pounds go to the nearest whole number; kilograms keep a half, since 2.5 kg is
 * the smallest plate on most racks.
 */
export function roundForDisplay(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? Math.round(value) : Math.round(value * 2) / 2;
}

/** A logged set's weight expressed in the user's chosen unit, display-rounded. */
export function setWeightIn(set: LoggedSet, unit: WeightUnit): number {
  return roundForDisplay(convertWeight(set.weight, set.unit, unit), unit);
}

/** Format a weight with its unit, e.g. `45 lb` or `22.5 kg`. */
export function formatWeight(value: number, unit: WeightUnit): string {
  return `${formatWeightValue(value, unit)} ${UNIT_LABEL[unit]}`;
}

/** Format just the number, dropping a trailing `.0` on kilograms. */
export function formatWeightValue(value: number, unit: WeightUnit): string {
  const rounded = roundForDisplay(value, unit);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Format a large aggregate such as weekly volume, with thousands separators. */
export function formatVolume(value: number, unit: WeightUnit): string {
  return `${Math.round(value).toLocaleString()} ${UNIT_LABEL[unit]}`;
}
