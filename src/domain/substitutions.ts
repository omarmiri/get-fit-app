import type { Exercise, Preferences, Station, StationOption, WeightUnit } from '@/types';
import { getStation } from '@/data/equipment';
import { roundForDisplay } from './units';
import { clampWeight } from './limits';

/**
 * Choosing where to perform an exercise, and what to do when that spot is taken.
 *
 * The gym problem this solves: you walk up to the bench you planned to use and
 * someone is sitting on it doing curls. You want an alternative that trains the
 * same thing, a note on where to find it, and a starting weight that is not a
 * guess — without losing your place in the session.
 */

/** One offered way to perform an exercise, resolved against the catalogue. */
export interface ResolvedOption {
  readonly station: Station;
  readonly option: StationOption;
  /** True when this is the exercise's default station. */
  readonly isPrimary: boolean;
  /** True when the user has marked this station missing from their club. */
  readonly missing: boolean;
  /** Suggested starting load, converted from the reference load. */
  readonly suggestedWeight: number | null;
  /** `per hand` when the load is per dumbbell, `per side` for plate-loaded. */
  readonly loadBasis: 'total' | 'per hand' | 'per side';
}

/**
 * All stations an exercise can be performed on, best first.
 *
 * Stations the user has marked missing are pushed to the bottom rather than
 * removed — the data is inferred, not authoritative, so a station being
 * flagged is a preference and needs to stay reversible.
 */
export function resolveOptions(
  exercise: Exercise,
  prefs: Preferences,
  referenceWeight: number | null,
  unit: WeightUnit,
): ResolvedOption[] {
  const options = exercise.stations ?? [];
  const missing = new Set(prefs.missingStations ?? []);
  const preferredId = prefs.preferredStations?.[exercise.id];

  const resolved: ResolvedOption[] = [];

  for (const [index, option] of options.entries()) {
    const station = getStation(option.stationId);
    if (!station) continue;

    resolved.push({
      station,
      option,
      isPrimary: index === 0,
      missing: missing.has(station.id),
      suggestedWeight: suggestLoad(referenceWeight, option, unit),
      loadBasis: loadBasisFor(station, option),
    });
  }

  return resolved.sort((a, b) => {
    // Missing equipment sinks; an explicit preference floats.
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    if (preferredId) {
      if (a.station.id === preferredId) return -1;
      if (b.station.id === preferredId) return 1;
    }
    return 0;
  });
}

/**
 * The station an exercise should open on.
 *
 * A remembered preference wins, then the first station that is not marked
 * missing, then the declared default. Returns `undefined` for exercises that
 * have no station options at all.
 */
export function defaultStationId(exercise: Exercise, prefs: Preferences): string | undefined {
  const options = exercise.stations ?? [];
  if (options.length === 0) return undefined;

  const preferred = prefs.preferredStations?.[exercise.id];
  if (preferred && options.some((o) => o.stationId === preferred)) return preferred;

  const missing = new Set(prefs.missingStations ?? []);
  const available = options.find((o) => !missing.has(o.stationId));
  return (available ?? options[0])?.stationId;
}

/**
 * Convert a load from the exercise's reference station to a candidate one.
 *
 * Returns `null` when there is nothing to convert from, or when the movement is
 * unloaded. The result is explicitly a starting point: machines differ in
 * leverage, lever length and friction, and no multiplier makes a leg press and
 * a hack squat equivalent. Better to open near the right number than at zero.
 */
export function suggestLoad(
  referenceWeight: number | null,
  option: StationOption,
  unit: WeightUnit,
): number | null {
  if (referenceWeight === null || referenceWeight <= 0) return null;

  const factor = option.loadFactor ?? 1;
  if (factor === 0) return 0;

  return clampWeight(roundToUsableIncrement(referenceWeight * factor, unit));
}

/**
 * Round a suggested load to something you can actually assemble.
 *
 * Dumbbells step in 5 lb / 2.5 kg, and plate maths lands on the same grid, so
 * suggesting 63 lb wastes the user's time working out what to pick up.
 */
export function roundToUsableIncrement(value: number, unit: WeightUnit): number {
  const step = unit === 'lb' ? 5 : 2.5;
  return roundForDisplay(Math.round(value / step) * step, unit);
}

/** How the number on this station should be read. */
export function loadBasisFor(station: Station, option: StationOption): ResolvedOption['loadBasis'] {
  if (option.perHand) return 'per hand';
  if (station.kind === 'plate-loaded') return 'per side';
  return 'total';
}

/** Short human label for the load basis, or empty when it is unremarkable. */
export function loadBasisLabel(basis: ResolvedOption['loadBasis']): string {
  return basis === 'total' ? '' : basis;
}
