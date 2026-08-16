import type { Exercise, LoggedSet, SetEffort, WeightUnit } from '@/types';
import { clampWeight } from './limits';
import { convertWeight, roundForDisplay } from './units';
import { roundToUsableIncrement } from './substitutions';

/**
 * Progressive overload.
 *
 * ## Double progression
 *
 * The plan prescribes rep *ranges* (8–12), so the natural scheme is double
 * progression: hold the weight and add reps until you reach the top of the
 * range on every set, then add weight and drop back to the bottom. It is the
 * standard answer for range-based programming, and it self-regulates — a hard
 * week simply means you stay put rather than being pushed by a calendar.
 *
 * ## Why this is arithmetic and not a language model
 *
 * Every decision here is a function of your own logged history. Written as
 * rules it is deterministic, runs with no signal in a gym basement, costs
 * nothing, and can be proven correct by tests. The same question put to an LLM
 * would give different answers to identical input and occasionally suggest a
 * 40 lb jump. Progression is the wrong shape of problem for that tool.
 *
 * ## Effort gates everything
 *
 * A set that reached the top of the range but felt maximal does not earn a load
 * increase. Reps are necessary but not sufficient; the honest report of how it
 * felt is what stops the recommendation from marching you into a wall.
 */

/** What the app suggests doing next, and why. */
export interface Recommendation {
  readonly weight: number;
  readonly reps: number;
  readonly unit: WeightUnit;
  /** One line explaining the suggestion, shown under the steppers. */
  readonly reason: string;
  readonly kind: RecommendationKind;
}

export type RecommendationKind =
  /** No history: an estimate from the profile, or nothing at all. */
  | 'opening'
  /** Same weight, one more rep. */
  | 'add-reps'
  /** Top of the range reached comfortably: add load, reset reps. */
  | 'add-weight'
  /** Repeat exactly — last time was hard, or reps fell short. */
  | 'repeat'
  /** Stuck for several sessions: back off to rebuild. */
  | 'deload';

/** One past session's work on a single exercise at a single station. */
export interface PerformanceBlock {
  readonly weight: number;
  readonly unit: WeightUnit;
  readonly reps: readonly number[];
  readonly efforts: readonly (SetEffort | undefined)[];
}

/**
 * How many consecutive sessions at the same weight without progress counts as
 * stalled. Two could be an off day; three is a pattern.
 */
export const STAGNATION_SESSIONS = 3;

/** Load jump as a fraction of current weight, floored at one usable increment. */
const INCREASE_FRACTION = 0.05;

/** How far to back off when stalled. */
const DELOAD_FRACTION = 0.1;

/**
 * Suggest the next set.
 *
 * `blocks` is the exercise's history at the *current station*, oldest first.
 * Station matters: a hack squat is not a leg press, and progressing one from
 * the other's numbers would be meaningless.
 */
export function recommend(
  exercise: Exercise,
  blocks: readonly PerformanceBlock[],
  unit: WeightUnit,
  openingWeight: number | null,
): Recommendation | null {
  // Timed holds and carries progress by duration, which the rep range already
  // expresses; there is nothing useful to say about load here.
  if (exercise.repMetric === 'seconds') return null;

  const last = blocks.at(-1);
  if (!last) return openingRecommendation(exercise, unit, openingWeight);

  const weight = roundForDisplay(convertWeight(last.weight, last.unit, unit), unit);
  const topReps = Math.min(...last.reps);
  const hardest = hardestEffort(last.efforts);

  if (isStalled(blocks, unit)) {
    // A deload makes the movement easier, which on an assisted machine means
    // *more* counterweight — the opposite arithmetic to a barbell.
    const factor = exercise.inverseLoad ? 1 + DELOAD_FRACTION : 1 - DELOAD_FRACTION;
    const deloaded = Math.max(0, roundToUsableIncrement(weight * factor, unit));

    return {
      weight: deloaded,
      reps: exercise.repMin,
      unit,
      kind: 'deload',
      reason: exercise.inverseLoad
        ? `Stuck at ${format(weight, unit)} assist for ${STAGNATION_SESSIONS} sessions. Take more help — ${format(deloaded, unit)} — and build back down.`
        : `Stuck at ${format(weight, unit)} for ${STAGNATION_SESSIONS} sessions. Drop to ${format(deloaded, unit)} and build back up.`,
    };
  }

  // Every set reached the top of the range, and none of them was maximal.
  if (topReps >= exercise.repMax && hardest !== 'hard') {
    const next = harderThan(exercise, weight, unit);
    return {
      weight: next,
      reps: exercise.repMin,
      unit,
      kind: 'add-weight',
      reason: exercise.inverseLoad
        ? `${exercise.repMax} reps at ${format(weight, unit)} assist last time${hardest === 'easy' ? ', and it felt easy' : ''}. Drop the assist to ${format(next, unit)}.`
        : `${exercise.repMax} reps at ${format(weight, unit)} last time${hardest === 'easy' ? ', and it felt easy' : ''}. Go to ${format(next, unit)}.`,
    };
  }

  // Reached the top, but it was a fight. Bank the rep quality first.
  if (topReps >= exercise.repMax) {
    return {
      weight,
      reps: exercise.repMax,
      unit,
      kind: 'repeat',
      reason: `Top of the range last time but it felt hard. Repeat ${format(weight, unit)} before adding load.`,
    };
  }

  // A maximal set below the top of the range: hold, do not chase reps.
  if (hardest === 'hard') {
    return {
      weight,
      reps: topReps,
      unit,
      kind: 'repeat',
      reason: `Last set felt hard. Stay at ${format(weight, unit)} × ${topReps} until it settles.`,
    };
  }

  const targetReps = Math.min(topReps + 1, exercise.repMax);
  return {
    weight,
    reps: targetReps,
    unit,
    kind: 'add-reps',
    reason: `${topReps} reps at ${format(weight, unit)} last time. Try ${targetReps}.`,
  };
}

function openingRecommendation(
  exercise: Exercise,
  unit: WeightUnit,
  openingWeight: number | null,
): Recommendation | null {
  if (openingWeight === null) return null;

  return {
    weight: openingWeight,
    reps: exercise.repMin,
    unit,
    kind: 'opening',
    // Phrased to stay true whichever way the number arrived — a bodyweight
    // estimate from the profile, or a load converted from another station
    // after a swap. The engine cannot tell those apart, so it should not
    // claim to.
    reason:
      openingWeight > 0
        ? `No history here yet. Treat the first set as a feeler — if ${exercise.repMin} reps feel easy, add weight.`
        : 'No history here yet. Start with bodyweight or the lightest setting and find your range.',
  };
}

/**
 * Whether the last several sessions sat at the same weight without reps moving.
 *
 * Compares against the best set of each session, so an extra back-off set does
 * not mask real progress.
 */
export function isStalled(blocks: readonly PerformanceBlock[], unit: WeightUnit): boolean {
  if (blocks.length < STAGNATION_SESSIONS) return false;

  const recent = blocks.slice(-STAGNATION_SESSIONS);
  const first = recent[0];
  if (!first) return false;

  const weightOf = (block: PerformanceBlock): number =>
    roundForDisplay(convertWeight(block.weight, block.unit, unit), unit);
  const bestOf = (block: PerformanceBlock): number => Math.max(...block.reps);

  const weight = weightOf(first);
  const bestFirst = bestOf(first);

  return recent.every((block) => weightOf(block) === weight && bestOf(block) <= bestFirst);
}

/** The most demanding effort reported across a session's sets. */
export function hardestEffort(efforts: readonly (SetEffort | undefined)[]): SetEffort | undefined {
  if (efforts.includes('hard')) return 'hard';
  if (efforts.includes('right')) return 'right';
  if (efforts.includes('easy')) return 'easy';
  return undefined;
}

/** Next weight up: about 5%, but never less than one loadable increment. */
export function increaseFrom(weight: number, unit: WeightUnit): number {
  const step = unit === 'lb' ? 5 : 2.5;
  const raised = roundToUsableIncrement(weight * (1 + INCREASE_FRACTION), unit);
  return raised > weight ? raised : roundForDisplay(weight + step, unit);
}

/** Next weight down: the mirror of `increaseFrom`, floored at zero. */
export function decreaseFrom(weight: number, unit: WeightUnit): number {
  const step = unit === 'lb' ? 5 : 2.5;
  const lowered = roundToUsableIncrement(weight * (1 - INCREASE_FRACTION), unit);
  const next = lowered < weight ? lowered : roundForDisplay(weight - step, unit);
  return Math.max(0, next);
}

/**
 * The load that makes this movement *harder*.
 *
 * On an assisted machine the stack is counterweight, so harder means less of
 * it. Everywhere the engine wants to progress someone it asks for this rather
 * than for "more weight", which is the distinction that stops assisted work
 * progressing backwards.
 *
 * Zero is a real answer here and worth reaching: no assistance at all is an
 * unassisted pull-up.
 */
export function harderThan(exercise: Exercise, weight: number, unit: WeightUnit): number {
  return exercise.inverseLoad ? decreaseFrom(weight, unit) : increaseFrom(weight, unit);
}

/** The load that makes it easier — what a deload wants. */
export function easierThan(exercise: Exercise, weight: number, unit: WeightUnit): number {
  return exercise.inverseLoad ? increaseFrom(weight, unit) : decreaseFrom(weight, unit);
}

/**
 * Group a flat list of sets into per-session blocks for one exercise at one
 * station, oldest first.
 *
 * Sets at different weights within a session collapse to the heaviest, which is
 * the working weight the recommendation should key off.
 */
export function toPerformanceBlocks(
  sets: readonly { readonly date: string; readonly set: LoggedSet }[],
): PerformanceBlock[] {
  const byDate = new Map<string, LoggedSet[]>();
  for (const { date, set } of sets) {
    const bucket = byDate.get(date);
    if (bucket) bucket.push(set);
    else byDate.set(date, [set]);
  }

  const blocks: PerformanceBlock[] = [];
  for (const [, group] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = group[0];
    // A date key only exists because a set was pushed under it, so the group is
    // never empty; the guard keeps the types honest without an assertion.
    if (!first) continue;

    const heaviest = group.reduce((best, set) => (set.weight > best.weight ? set : best), first);
    const working = group.filter((set) => set.weight === heaviest.weight && set.unit === heaviest.unit);

    blocks.push({
      weight: heaviest.weight,
      unit: heaviest.unit,
      reps: working.map((set) => set.reps),
      efforts: working.map((set) => set.effort),
    });
  }
  return blocks;
}

function format(weight: number, unit: WeightUnit): string {
  const rounded = roundForDisplay(weight, unit);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

/* ------------------------------------------------ within-session ramping */

/**
 * Ramping the load *within* a session, set to set.
 *
 * `recommend` above answers "where should today start", from what happened in
 * past sessions. It deliberately says nothing once the first set is logged.
 * That leaves a real gap: early sets are often feelers, and a set that felt
 * easy should not be repeated at the same load three more times just because
 * last week's history has not changed.
 *
 * The gate is the same one the cross-session engine uses — the honest report of
 * how the set felt — but the jumps are larger, because ramping up to a working
 * weight inside one session is a different move from a week-over-week increase.
 * `hard` ends the ramp; that is what stops it walking you into a failed set.
 *
 * Every number produced here is a seed for the stepper, never a commitment. The
 * user can always overrule it before logging.
 */

/**
 * How big a load jump a movement can absorb, by the size of what it works.
 *
 * A leg press moves in plates; a lateral raise moves in the smallest dumbbell
 * on the rack. Applying one increment to both would either stall the legs or
 * wreck the shoulders.
 */
export type LoadClass = 'lower' | 'upper' | 'small';

/**
 * Muscles that mark a movement as a big lower-body lift.
 *
 * Calves are deliberately absent: a calf raise is a small-muscle isolation
 * movement that happens to be below the waist.
 */
const LOWER_BODY_MUSCLES: ReadonlySet<string> = new Set([
  'quads',
  'glutes',
  'hamstrings',
  'adductors',
  'abductors',
]);

/** Muscles small enough that a movement working *only* these gets the smallest jump. */
const SMALL_MUSCLES: ReadonlySet<string> = new Set([
  'side delts',
  'rear delts',
  'front delts',
  'biceps',
  'triceps',
  'forearms',
  'grip',
  'calves',
  'core',
  'obliques',
  'abs',
  'traps',
]);

/** The jump applied to a set that felt easy, by class and unit. */
const FULL_JUMP: Readonly<Record<LoadClass, Readonly<Record<WeightUnit, number>>>> = {
  lower: { lb: 20, kg: 10 },
  upper: { lb: 10, kg: 5 },
  small: { lb: 5, kg: 2.5 },
};

/**
 * Classify a movement from the muscles it lists.
 *
 * Falls back to `upper` — the middle tier — when an exercise carries no muscle
 * list, which is the safe direction to be wrong in: too small a jump costs one
 * extra tap, too large a jump costs a failed set.
 */
export function loadClassFor(exercise: Exercise): LoadClass {
  const muscles = exercise.muscles?.map((muscle) => muscle.toLowerCase()) ?? [];
  if (muscles.length === 0) return 'upper';

  // Checked first: "biceps" appears alongside "lats" on a row, and a row is not
  // an isolation movement. Only an all-small list earns the small jump.
  if (muscles.every((muscle) => SMALL_MUSCLES.has(muscle))) return 'small';
  if (muscles.some((muscle) => LOWER_BODY_MUSCLES.has(muscle))) return 'lower';
  return 'upper';
}

/**
 * The load increase earned by a set that felt `effort`.
 *
 * `easy` takes the full jump. `right` takes half of it, floored at one loadable
 * increment: the set was at the intended difficulty, so it earns a nudge rather
 * than a leap. `hard` earns nothing.
 */
export function rampJump(exercise: Exercise, effort: SetEffort, unit: WeightUnit): number {
  if (effort === 'hard') return 0;

  const full = FULL_JUMP[loadClassFor(exercise)][unit];
  if (effort === 'easy') return full;

  const smallest = unit === 'lb' ? 5 : 2.5;
  return Math.max(smallest, roundToUsableIncrement(full / 2, unit));
}

/** What to put in the stepper for the next set, and why. */
export interface SetAdjustment {
  readonly weight: number;
  /** Change from the set just logged. Zero when holding. */
  readonly delta: number;
  readonly reason: string;
  readonly kind: 'add-weight' | 'repeat';
}

/**
 * Adjust the load for the next set from how the last one felt.
 *
 * Returns `null` whenever there is nothing honest to say — a timed hold, an
 * unloaded movement, a bodyweight set at zero, or a set logged without an
 * effort report. In every one of those cases the caller should simply repeat
 * the last weight.
 */
export function adjustAfterSet(
  exercise: Exercise,
  lastWeight: number,
  effort: SetEffort | undefined,
  unit: WeightUnit,
): SetAdjustment | null {
  if (exercise.repMetric === 'seconds' || !exercise.loaded) return null;
  if (effort === undefined) return null;
  // Nothing to scale from. A bodyweight set logged at zero has no load to add
  // a percentage of, and jumping straight to 20 lb would be a guess.
  if (lastWeight <= 0) return null;

  if (effort === 'hard') {
    return {
      weight: lastWeight,
      delta: 0,
      kind: 'repeat',
      reason: `That set felt hard — holding at ${format(lastWeight, unit)}.`,
    };
  }

  const jump = rampJump(exercise, effort, unit);
  // On an assisted machine the ramp runs downward: less counterweight is more
  // work. Floored at zero, which is a real destination rather than a limit —
  // no assistance is an unassisted rep.
  const weight = exercise.inverseLoad
    ? Math.max(0, clampWeight(lastWeight - jump))
    : clampWeight(lastWeight + jump);

  const moved = exercise.inverseLoad ? weight < lastWeight : weight > lastWeight;

  // The clamp can swallow the change at either end of the range.
  if (!moved) {
    return {
      weight: lastWeight,
      delta: 0,
      kind: 'repeat',
      reason: `Staying at ${format(lastWeight, unit)}.`,
    };
  }

  const size = Math.abs(weight - lastWeight);

  return {
    weight,
    delta: weight - lastWeight,
    kind: 'add-weight',
    reason: exercise.inverseLoad
      ? effort === 'easy'
        ? `Last set felt easy — ${format(size, unit)} less help, down to ${format(weight, unit)}.`
        : `Last set was on target — a little less help, ${format(weight, unit)}. Take more back if that is too much.`
      : effort === 'easy'
        ? `Last set felt easy — up ${format(size, unit)} to ${format(weight, unit)}.`
        : `Last set was on target — nudged up to ${format(weight, unit)}. Dial it back if that is too much.`,
  };
}
