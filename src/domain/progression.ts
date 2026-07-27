import type { Exercise, LoggedSet, SetEffort, WeightUnit } from '@/types';
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
    const deloaded = roundToUsableIncrement(weight * (1 - DELOAD_FRACTION), unit);
    return {
      weight: Math.max(0, deloaded),
      reps: exercise.repMin,
      unit,
      kind: 'deload',
      reason: `Stuck at ${format(weight, unit)} for ${STAGNATION_SESSIONS} sessions. Drop to ${format(deloaded, unit)} and build back up.`,
    };
  }

  // Every set reached the top of the range, and none of them was maximal.
  if (topReps >= exercise.repMax && hardest !== 'hard') {
    const next = increaseFrom(weight, unit);
    return {
      weight: next,
      reps: exercise.repMin,
      unit,
      kind: 'add-weight',
      reason: `${exercise.repMax} reps at ${format(weight, unit)} last time${hardest === 'easy' ? ', and it felt easy' : ''}. Go to ${format(next, unit)}.`,
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
