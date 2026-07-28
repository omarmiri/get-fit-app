import type { DayKey, GeneratedDay, GeneratedPlan } from '@/types';
import { getExercise } from '@/data/exercises';
import { getStation } from '@/data/equipment';
import { DAY_KEYS, GOALS } from '@/data/plan';

/**
 * Deterministic validation of a generated plan.
 *
 * The model is non-deterministic; this gate is not. Every plan — generated or
 * built-in — has to pass the same checks before it can be used, which turns
 * "is this plan any good" from a matter of taste into something answerable.
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
}

export interface ValidationContext {
  /** Stations the user has marked absent from their club. */
  readonly missingStationIds?: readonly string[];
}

export function validatePlan(plan: GeneratedPlan, context: ValidationContext = {}): PlanValidation {
  const issues: PlanIssue[] = [];
  const missing = new Set(context.missingStationIds ?? []);

  const byDay = new Map<DayKey, GeneratedDay>();
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
    issues.push(...validateDay(day, missing));

    if (day.aerobic && day.minutes) weeklyAerobicMinutes += day.minutes;
    if (day.type === 'strength') strengthDays += 1;
  }

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
  };
}

function validateDay(day: GeneratedDay, missing: ReadonlySet<string>): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const at = (severity: IssueSeverity, message: string): PlanIssue => ({
    severity,
    message,
    dayKey: day.dayKey,
  });

  if (!day.label.trim()) issues.push(at('error', `${day.dayKey}: no label.`));
  if (day.outline.length === 0) issues.push(at('error', `${day.dayKey}: no session outline.`));

  /*
   * The critical check. Exercise ids are persistence keys, and every catalogue
   * entry carries cues, station mappings, load conversions and a bodyweight
   * factor. An invented movement has none of that, so it would render without
   * substitutions, without a starting weight, and without progression — and it
   * would orphan any history logged against it.
   */
  for (const id of day.exerciseIds ?? []) {
    if (!getExercise(id)) {
      issues.push(at('error', `${day.dayKey}: unknown exercise "${id}".`));
    }
  }

  for (const id of day.modalityStations ?? []) {
    const station = getStation(id);
    if (!station) {
      issues.push(at('error', `${day.dayKey}: unknown station "${id}".`));
    } else if (missing.has(id)) {
      issues.push(at('warning', `${day.dayKey}: ${station.name} is marked as not at your club.`));
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
    if ((day.modalityStations?.length ?? 0) === 0) {
      issues.push(at('error', `${day.dayKey}: timed day with nowhere to do it.`));
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
function consecutiveStrengthDays(byDay: ReadonlyMap<DayKey, GeneratedDay>): DayKey[] {
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
