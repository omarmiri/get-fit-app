import type { LoggedSet, Session, WeightUnit } from '@/types';
import type { ExerciseSource } from '@/data/catalogue';
import { isTrendable } from '@/data/exercises';
import { resolveExercise } from '@/data/catalogue';
import { convertWeight } from './units';

/**
 * Training metrics.
 *
 * These are estimates for spotting a trend, not measurements. The absolute
 * numbers matter far less than whether the line is going up.
 */

/**
 * Estimated one-rep max via the Epley formula: `w × (1 + r/30)`.
 *
 * Two adjustments to the raw formula:
 *
 * - A single rep returns the weight itself. Epley is discontinuous at r=1,
 *   reporting 103% of a genuine one-rep max, which would make an actual max
 *   attempt look like a 3% gain over itself.
 * - Reps above 12 are capped rather than extrapolated. The formula was fitted
 *   on low rep ranges, and a light 30-rep set would otherwise claim a maximum
 *   of double the weight lifted.
 *
 * Returns `null` when the set cannot produce an estimate at all.
 */
export function estimateOneRepMax(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;
  if (weight <= 0 || reps < 1) return null;
  if (reps === 1) return weight;
  const cappedReps = Math.min(reps, 12);
  return weight * (1 + cappedReps / 30);
}

/**
 * Best estimated one-rep max across a session's sets for one exercise,
 * expressed in `unit`. Returns `null` when no set qualifies.
 *
 * Only loaded, rep-counted exercises are considered — a plank has no 1RM.
 */
export function bestOneRepMax(
  session: Session,
  exerciseId: string,
  unit: WeightUnit,
  source: ExerciseSource = {},
): number | null {
  const exercise = resolveExercise(exerciseId, source);
  if (!exercise || !isTrendable(exercise)) return null;

  let best: number | null = null;
  for (const set of session.sets) {
    if (set.exerciseId !== exerciseId) continue;
    const estimate = estimateOneRepMax(convertWeight(set.weight, set.unit, unit), set.reps);
    if (estimate !== null && (best === null || estimate > best)) best = estimate;
  }
  return best;
}

/**
 * Total load moved, as `weight × reps` summed across sets and converted to
 * `unit`.
 *
 * Timed work is excluded: multiplying a carry's weight by its duration in
 * seconds produces a number in the wrong dimension entirely, and mixing it into
 * the total would swamp the real volume.
 */
export function sessionVolume(
  sets: readonly LoggedSet[],
  unit: WeightUnit,
  source: ExerciseSource = {},
): number {
  let total = 0;
  for (const set of sets) {
    const exercise = resolveExercise(set.exerciseId, source);
    if (exercise?.repMetric === 'seconds') continue;
    total += convertWeight(set.weight, set.unit, unit) * set.reps;
  }
  return total;
}

/** How many sets of one exercise a session contains. */
export function setsForExercise(sets: readonly LoggedSet[], exerciseId: string): LoggedSet[] {
  return sets.filter((set) => set.exerciseId === exerciseId);
}

/** Percentage change from `first` to `last`, or `null` when undefined. */
export function percentChange(first: number, last: number): number | null {
  if (!Number.isFinite(first) || first === 0) return null;
  return ((last - first) / first) * 100;
}
