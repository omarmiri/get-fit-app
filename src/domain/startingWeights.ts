import type { Exercise, StationOption, UserProfile, WeightUnit } from '@/types';
import { convertWeight } from './units';
import { roundToUsableIncrement } from './substitutions';

/**
 * First-session weight estimates.
 *
 * ## These are deliberately too light
 *
 * The two failure modes are not symmetric. Starting 20 lb too light costs one
 * set — you notice immediately, add weight, and carry on. Starting 20 lb too
 * heavy on a movement you have never done risks a strain that costs weeks, and
 * it happens on the rep where your form breaks, not the one where you notice.
 *
 * So every number here is biased low, rounded *down* to the nearest usable
 * increment, and presented to the user as a floor to work up from rather than a
 * prescription. The app says so on screen.
 *
 * ## What these are not
 *
 * Not a strength standard, not a prediction, and not personalised in any
 * meaningful sense — a bodyweight ratio scaled by a self-reported experience
 * level is a crude instrument. It exists so the first session starts somewhere
 * defensible instead of at zero, and it stops mattering the moment there is one
 * real logged set to progress from.
 */

/**
 * Multiplier on the novice bodyweight factor, by self-reported experience.
 *
 * `returning` is only modestly above `new` on purpose: coming back after a
 * layoff, your connective tissue is further behind your muscle memory than it
 * feels, and the first weeks are where people get hurt.
 */
const LEVEL_FACTOR: Readonly<Record<UserProfile['level'], number>> = {
  new: 1,
  returning: 1.25,
  experienced: 1.6,
};

/**
 * Gentle taper with age, applied above 50.
 *
 * Not a claim about capacity — plenty of 60-year-olds out-lift plenty of
 * 30-year-olds. It reflects that recovery from an over-ambitious first session
 * takes longer, so the cost of guessing high rises.
 */
function ageFactor(age: number): number {
  if (!Number.isFinite(age) || age <= 50) return 1;
  const decadesPast50 = (Math.min(age, 90) - 50) / 10;
  return Math.max(0.7, 1 - decadesPast50 * 0.075);
}

/**
 * Suggested opening weight for an exercise, in `unit`.
 *
 * Returns `null` when there is nothing sensible to suggest: no profile, or a
 * bodyweight movement that should simply start unloaded.
 */
export function startingWeight(
  exercise: Exercise,
  profile: UserProfile | undefined,
  unit: WeightUnit,
  option?: StationOption,
): number | null {
  if (!profile) return null;
  if (exercise.bodyweightFactor === undefined) return null;
  if (!Number.isFinite(profile.bodyweight) || profile.bodyweight <= 0) return null;

  const bodyweight = convertWeight(profile.bodyweight, profile.bodyweightUnit, unit);
  const base = bodyweight * exercise.bodyweightFactor;
  const scaled = base * LEVEL_FACTOR[profile.level] * ageFactor(profile.age);

  // Apply the station conversion too, so someone who opens on dumbbells gets a
  // per-hand number rather than the machine equivalent.
  const adjusted = scaled * (option?.loadFactor ?? 1);

  return floorToIncrement(adjusted, unit);
}

/**
 * Round down to a loadable increment.
 *
 * Down, not nearest — this is the one place in the app where the rounding
 * direction is a safety decision rather than a cosmetic one.
 */
export function floorToIncrement(value: number, unit: WeightUnit): number {
  const step = unit === 'lb' ? 5 : 2.5;
  const floored = Math.floor(value / step) * step;
  return Math.max(0, roundToUsableIncrement(floored, unit));
}

/** Whether a profile has enough in it to estimate from. */
export function isUsableProfile(profile: UserProfile | undefined): profile is UserProfile {
  return (
    profile !== undefined &&
    Number.isFinite(profile.bodyweight) &&
    profile.bodyweight > 0 &&
    Number.isFinite(profile.age) &&
    profile.age > 0
  );
}
