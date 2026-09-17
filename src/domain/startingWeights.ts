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
function ageFactor(age: number | undefined): number {
  if (age === undefined) return 1;
  if (!Number.isFinite(age) || age <= 50) return 1;
  const decadesPast50 = (Math.min(age, 90) - 50) / 10;
  return Math.max(0.7, 1 - decadesPast50 * 0.075);
}

/**
 * Suggested opening weight for an exercise, in `unit`.
 *
 * Returns `null` when there is nothing sensible to suggest: no profile, or a
 * bodyweight movement that should simply start unloaded.
 *
 * An opening weight named by the plan's author wins over the bodyweight-ratio
 * estimate. It is the more specific claim — someone who knows the movement
 * picked a number for it, where the ratio is a crude instrument applied to a
 * movement it has never seen. It still gets rounded down and still gets shown
 * as a floor to work up from, because the reasoning at the top of this file
 * does not stop applying just because a model did the guessing.
 */
/**
 * The profile used when there is none.
 *
 * Asking three questions before anybody has lifted anything bought an estimate
 * the app already rounds down and throws away after one logged set. So it is
 * not asked: every movement opens from this instead — a novice factor at a
 * middling bodyweight, which is the same conservative floor the form produced
 * for most people — and one question at the first machine scales it.
 *
 * Deliberately not surfaced as "we assumed you weigh this". It is the shape of
 * a floor to work up from, and the screen says so in those terms.
 */
export const ASSUMED_PROFILE: UserProfile = {
  bodyweight: 155,
  bodyweightUnit: 'lb',
  level: 'new',
  recordedOn: '1970-01-01',
};

/**
 * Apply the user's one calibration answer to an estimate.
 *
 * Still rounded in the cautious direction afterwards, because the reasoning at
 * the top of this file does not stop applying because somebody said "too
 * light" once.
 */
export function scaleOpening(value: number, scale: number, unit: WeightUnit, inverse = false): number {
  if (!Number.isFinite(scale) || scale <= 0) return value;
  return safeIncrement(value * scale, unit, inverse);
}

export function startingWeight(
  exercise: Exercise,
  profile: UserProfile | undefined,
  unit: WeightUnit,
  option?: StationOption,
): number | null {
  const authored = exercise.openingWeight;
  if (authored && authored.value > 0) {
    const converted = convertWeight(authored.value, authored.unit, unit);
    return safeIncrement(converted * (option?.loadFactor ?? 1), unit, exercise.inverseLoad === true);
  }

  if (!profile) return null;
  if (exercise.bodyweightFactor === undefined) return null;
  if (!Number.isFinite(profile.bodyweight) || profile.bodyweight <= 0) return null;

  const bodyweight = convertWeight(profile.bodyweight, profile.bodyweightUnit, unit);
  const base = bodyweight * exercise.bodyweightFactor;
  const scaled = base * LEVEL_FACTOR[profile.level] * ageFactor(profile.age);

  // Apply the station conversion too, so someone who opens on dumbbells gets a
  // per-hand number rather than the machine equivalent.
  const adjusted = scaled * (option?.loadFactor ?? 1);

  return safeIncrement(adjusted, unit, exercise.inverseLoad === true);
}

/**
 * Round in whichever direction is the cautious one.
 *
 * The whole file rounds *down*, because on a barbell less weight is the safe
 * mistake. On an assisted machine the number is counterweight, so down means
 * *less help* — the same rounding that protects a novice on a leg press is the
 * one that drops them onto an unassisted pull-up. Erring light means erring
 * upward there.
 */
function safeIncrement(value: number, unit: WeightUnit, inverse: boolean): number {
  return inverse ? ceilToIncrement(value, unit) : floorToIncrement(value, unit);
}

/** Round up to a loadable increment — the cautious direction for assisted work. */
export function ceilToIncrement(value: number, unit: WeightUnit): number {
  const step = unit === 'lb' ? 5 : 2.5;
  const ceiled = Math.ceil(value / step) * step;
  return Math.max(0, roundToUsableIncrement(ceiled, unit));
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
  return profile !== undefined && Number.isFinite(profile.bodyweight) && profile.bodyweight > 0;
}
