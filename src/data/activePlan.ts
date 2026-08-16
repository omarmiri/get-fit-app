import type { DayKey, PlanDay, UserPlan, UserPlanDay } from '@/types';
import { resolveExercise } from './catalogue';
import { PLATE } from './plates';
import { DAY_KEYS, PLAN } from './plan';

/**
 * Resolving whichever plan is in force into the `PlanDay` shape the app renders.
 *
 * A generated plan stores only *references* — exercise ids and station ids.
 * Resolution is where those become real catalogue objects, which is what makes
 * a generated day inherit everything the built-in plan has: coaching cues,
 * plain-language summaries, station substitutions, starting weights and
 * progression history. The model never has to supply any of it, and therefore
 * never has a chance to get it wrong.
 *
 * The built-in plan remains the fallback. If a generated plan is absent, or a
 * day within it fails to resolve, the corresponding built-in day is used — so
 * there is always a complete, known-good week.
 */

/** Accent colour by session type, since a generated day has no plate assigned. */
const COLOR_BY_TYPE: Readonly<Record<string, string>> = {
  strength: PLATE.red,
  intervals: PLATE.yellow,
  mixed: PLATE.yellow,
  duration: PLATE.blue,
  rest: PLATE.white,
};

const LOAD_BY_TYPE: Readonly<Record<string, string>> = {
  strength: '25 kg',
  intervals: '15 kg',
  mixed: '15 kg',
  duration: '20 kg',
  rest: '5 kg',
};

/**
 * The plan currently in force, as a complete seven-day record.
 *
 * Pass `null` for the built-in plan.
 */
export function resolvePlan(plan: UserPlan | null): Readonly<Record<DayKey, PlanDay>> {
  if (!plan) return PLAN;

  const byDay = new Map<DayKey, UserPlanDay>(plan.days.map((day) => [day.dayKey, day]));
  const resolved: Partial<Record<DayKey, PlanDay>> = {};

  for (const key of DAY_KEYS) {
    const day = byDay.get(key);
    resolved[key] = day ? (resolveDay(day, plan) ?? PLAN[key]) : PLAN[key];
  }

  return resolved as Record<DayKey, PlanDay>;
}

/** Turn one plan day into a `PlanDay`, or `null` if it cannot be used. */
function resolveDay(day: UserPlanDay, plan: UserPlan): PlanDay | null {
  if (!day.label.trim()) return null;

  // Rest days have no counterpart in `SessionType`; they render as a very light
  // duration day with nothing prescribed, which is what a rest day is.
  const type = day.type === 'rest' ? 'duration' : day.type;

  const exercises = (day.exerciseIds ?? [])
    .map((id) => resolveExercise(id, { plan }))
    .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== undefined);

  const outline = day.outline.length > 0 ? day.outline : [day.sub || day.label];

  /*
   * A day may name its cardio in prose instead of referencing a station, for
   * gyms whose equipment the app has no vocabulary for. That sentence is
   * appended to the outline rather than dropped: the outline is what the user
   * actually reads before starting, and "how do I do the cardio" is not an
   * optional detail.
   */
  const withModality = day.modality && !day.modalityStations?.length ? [...outline, day.modality] : outline;

  return {
    key: day.dayKey,
    label: day.label,
    type,
    color: COLOR_BY_TYPE[day.type] ?? PLATE.white,
    load: LOAD_BY_TYPE[day.type] ?? '5 kg',
    sub: day.sub,
    note: day.note,
    outline: withModality,
    aerobic: day.aerobic,
    ...(day.minutes !== undefined ? { minutes: day.minutes } : {}),
    ...(day.modalityStations && day.modalityStations.length > 0
      ? { modalityStations: day.modalityStations }
      : {}),
    ...(exercises.length > 0 ? { exercises } : {}),
    ...(day.exerciseFormat ? { exerciseFormat: day.exerciseFormat } : {}),
    ...(day.rounds ? { rounds: day.rounds } : {}),
  };
}

/** A one-line description of which plan is in force, for the Plan tab. */
export function describePlanSource(plan: UserPlan | null): string {
  if (!plan) return 'Built-in seven-day rotation';
  const when = new Date(plan.generatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${plan.model} · ${when}`;
}

/**
 * What to call a plan in the library.
 *
 * The user's own name wins. Failing that, who wrote it and when — which is how
 * plans were identified before they could be named, and is enough to tell two
 * apart in a list.
 */
export function describePlanName(plan: UserPlan): string {
  // A name that is present but blank falls back too, so `??` would be wrong.
  const named = plan.name?.trim() ?? '';
  return named.length > 0 ? named : describePlanSource(plan);
}
