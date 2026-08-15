import type { DayKey, UserPlan, UserPlanDay } from '@/types';
import { resolveExercise } from '@/data/catalogue';
import { getStation } from '@/data/equipment';
import { DAY_KEYS, GOALS } from '@/data/plan';

/**
 * Deterministic validation of a plan, wherever it came from.
 *
 * The author is non-deterministic; this gate is not. Every plan — generated
 * in-app, imported from someone's chatbot, or built in — passes the same
 * checks before it can be used, which turns "is this plan any good" from a
 * matter of taste into something answerable.
 *
 * This is the load-bearing part of letting users bring plans from any LLM. The
 * app cannot vouch for the training advice in an imported file, and does not
 * try to. What it can do is guarantee the file will not break the app, will
 * not silently lose a day, and will not quietly prescribe nothing on a day
 * that claims to be a workout — and then show the user everything it noticed
 * before they commit to it.
 *
 * Two classes of finding:
 *
 * - `error` blocks the plan. Dangling ids, missing days, structural nonsense.
 *   These would break the app, not merely make it a mediocre programme.
 * - `warning` is shown but does not block. Falling short of the weekly aerobic
 *   target is a judgement call the user is allowed to make; referencing a
 *   machine they have flagged as absent is worth saying out loud.
 */

export type IssueSeverity = 'error' | 'warning';

export interface PlanIssue {
  readonly severity: IssueSeverity;
  readonly message: string;
  /** Which day the issue is on, when it is day-specific. */
  readonly dayKey?: DayKey;
}

export interface PlanValidation {
  readonly ok: boolean;
  readonly issues: readonly PlanIssue[];
  /** Aerobic minutes across the week, for the summary line. */
  readonly weeklyAerobicMinutes: number;
  readonly strengthDays: number;
  /** How many movements the plan defined itself, rather than referencing. */
  readonly customExercises: number;
}

export interface ValidationContext {
  /** Stations the user has marked absent from their gym. */
  readonly missingStationIds?: readonly string[];
}

export function validatePlan(plan: UserPlan, context: ValidationContext = {}): PlanValidation {
  const issues: PlanIssue[] = [];
  const missing = new Set(context.missingStationIds ?? []);

  const byDay = new Map<DayKey, UserPlanDay>();
  for (const day of plan.days) {
    if (byDay.has(day.dayKey)) {
      issues.push({ severity: 'error', message: `Duplicate day: ${day.dayKey}`, dayKey: day.dayKey });
      continue;
    }
    byDay.set(day.dayKey, day);
  }

  for (const key of DAY_KEYS) {
    if (!byDay.has(key)) {
      issues.push({ severity: 'error', message: `Missing day: ${key}`, dayKey: key });
    }
  }

  let weeklyAerobicMinutes = 0;
  let strengthDays = 0;

  for (const day of byDay.values()) {
    issues.push(...validateDay(day, plan, missing));

    if (day.aerobic && day.minutes) weeklyAerobicMinutes += day.minutes;
    if (day.type === 'strength') strengthDays += 1;
  }

  issues.push(...validateCustomExercises(plan));

  // Guideline checks. Warnings, not errors — the user may knowingly run a
  // lighter week, and the app should not refuse to show them their own plan.
  if (weeklyAerobicMinutes < GOALS.minutes) {
    issues.push({
      severity: 'warning',
      message: `Only ${weeklyAerobicMinutes} aerobic minutes this week, below the ${GOALS.minutes} minute target.`,
    });
  }

  if (strengthDays < GOALS.strength) {
    issues.push({
      severity: 'warning',
      message: `Only ${strengthDays} strength ${strengthDays === 1 ? 'day' : 'days'}, below the target of ${GOALS.strength}.`,
    });
  }

  const consecutive = consecutiveStrengthDays(byDay);
  if (consecutive.length > 0) {
    issues.push({
      severity: 'warning',
      message: `Strength days back to back (${consecutive.join(', ')}). Full-body sessions usually want a day between them.`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    weeklyAerobicMinutes,
    strengthDays,
    customExercises: plan.exercises?.length ?? 0,
  };
}

/**
 * Checks on movements the plan invented.
 *
 * These are warnings, deliberately. A custom movement with a thin coaching cue
 * is worse than a built-in one but still better than no plan, and the user is
 * entitled to run a week their LLM wrote badly. What they are not entitled to
 * is not being told.
 */
function validateCustomExercises(plan: UserPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const used = new Set(plan.days.flatMap((day) => day.exerciseIds ?? []));

  for (const exercise of plan.exercises ?? []) {
    if (!used.has(exercise.id)) {
      issues.push({
        severity: 'warning',
        message: `"${exercise.name}" is defined but never used on any day.`,
      });
    }

    if (exercise.repMin > exercise.repMax) {
      issues.push({
        severity: 'error',
        message: `"${exercise.name}" has a rep range that runs backwards.`,
      });
    }

    /*
     * A loaded movement with no equipment named and no station that resolves
     * is one the user cannot act on: they are told to do three sets of
     * something with weight, and nothing says what to put the weight on.
     */
    if (exercise.loaded && !exercise.equipment && (exercise.stations?.length ?? 0) === 0) {
      issues.push({
        severity: 'warning',
        message: `"${exercise.name}" is a weighted movement but names no equipment.`,
      });
    }
  }

  return issues;
}

function validateDay(day: UserPlanDay, plan: UserPlan, missing: ReadonlySet<string>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const at = (severity: IssueSeverity, message: string): PlanIssue => ({
    severity,
    message,
    dayKey: day.dayKey,
  });

  if (!day.label.trim()) issues.push(at('error', `${day.dayKey}: no label.`));
  if (day.outline.length === 0) issues.push(at('error', `${day.dayKey}: no session outline.`));

  /*
   * Every referenced movement has to resolve — to the built-in catalogue or to
   * something this plan defined for itself. An id that resolves to neither
   * would render as a gap in the day's rail: the user is told to do six
   * movements and shown five, with nothing saying why.
   */
  for (const id of day.exerciseIds ?? []) {
    if (!resolveExercise(id, plan)) {
      issues.push(at('error', `${day.dayKey}: unknown exercise "${id}".`));
    }
  }

  for (const id of day.modalityStations ?? []) {
    const station = getStation(id);
    if (!station) {
      issues.push(at('error', `${day.dayKey}: unknown station "${id}".`));
    } else if (missing.has(id)) {
      issues.push(at('warning', `${day.dayKey}: ${station.name} is marked as not at your gym.`));
    }
  }

  if (day.type === 'strength') {
    if ((day.exerciseIds?.length ?? 0) === 0) {
      issues.push(at('error', `${day.dayKey}: strength day with no exercises.`));
    }
  }

  if (day.type === 'duration' || day.type === 'intervals' || day.type === 'mixed') {
    if (!day.minutes || day.minutes <= 0) {
      issues.push(at('error', `${day.dayKey}: timed day with no duration.`));
    }
    // Either a station the app knows or the author's own description will do.
    // Requiring a catalogue id here would reject any plan written for a gym
    // whose equipment this app has no name for, which is most of them.
    if ((day.modalityStations?.length ?? 0) === 0 && !day.modality) {
      issues.push(at('error', `${day.dayKey}: timed day that does not say what to do.`));
    }
  }

  if (day.minutes !== undefined && (day.minutes < 0 || day.minutes > 240)) {
    issues.push(at('error', `${day.dayKey}: implausible duration of ${day.minutes} minutes.`));
  }

  if (day.exerciseFormat === 'circuit' && !day.rounds) {
    issues.push(at('warning', `${day.dayKey}: circuit without a round count.`));
  }

  return issues;
}

/** Strength days that fall on consecutive calendar days, week wrapping included. */
function consecutiveStrengthDays(byDay: ReadonlyMap<DayKey, UserPlanDay>): DayKey[] {
  const flagged: DayKey[] = [];

  for (let i = 0; i < DAY_KEYS.length; i += 1) {
    const key = DAY_KEYS[i];
    const nextKey = DAY_KEYS[(i + 1) % DAY_KEYS.length];
    if (!key || !nextKey) continue;

    if (byDay.get(key)?.type === 'strength' && byDay.get(nextKey)?.type === 'strength') {
      flagged.push(key, nextKey);
    }
  }

  return [...new Set(flagged)];
}

/** Only the blocking issues, for when a plan has to be rejected. */
export function errorsOf(validation: PlanValidation): readonly PlanIssue[] {
  return validation.issues.filter((issue) => issue.severity === 'error');
}
