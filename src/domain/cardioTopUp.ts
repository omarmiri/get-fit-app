import type { DayKey, UserPlan, UserPlanDay } from '@/types';
import { DAY_NAMES, GOALS } from '@/data/plan';

/**
 * Adding the cardio minutes a plan fell short of, when the user asks.
 *
 * ## Why this is offered rather than done
 *
 * Falling short of the weekly target is allowed on purpose — a deload week,
 * or a person who knows what they are doing, is entitled to run fewer
 * minutes, and the validator only warns. So the plan is never changed behind
 * the user's back; the review offers this as a button, and says exactly what
 * it would change.
 *
 * ## Where the minutes go, in order
 *
 * 1. Longer cardio days. The existing sessions are the least surprising place,
 *    up to an hour each.
 * 2. A cardio finisher on strength days, which become mixed days — lifts, then
 *    up to twenty easy minutes. This is how a strength-heavy week with few
 *    free days reaches the target without losing a lifting day.
 * 3. An easy walk on rest days, up to half an hour. Last, because rest days
 *    are the ones the author chose to leave empty — but a conversational walk
 *    is recovery, not training load.
 *
 * Minutes move in five-minute steps, round-robin, so they spread across the
 * week instead of piling onto one day.
 */

const STEP = 5;
const MAX_CARDIO_DAY = 60;
const MAX_FINISHER = 20;
const MAX_WALK = 30;

/*
 * The smallest block worth adding where there was none. A five-minute walk is
 * not a session anyone puts shoes on for, so a new block starts at a size
 * that is — overshooting the target by a few minutes rather than scattering
 * crumbs across the week.
 */
const MIN_FINISHER = 10;
const MIN_WALK = 20;

const FINISHER_MODALITY = 'Easy cardio — bike, treadmill or elliptical';
const WALK_MODALITY = 'Brisk walk, outdoors or on a treadmill';

export interface CardioTopUp {
  readonly plan: UserPlan;
  /** Minutes added across the week. */
  readonly added: number;
  /** One line per changed day, e.g. `Tue: 20 min cardio after the lifts`. */
  readonly changes: readonly string[];
}

/** Aerobic minutes a plan prescribes across its week. */
export function aerobicMinutes(plan: UserPlan): number {
  return plan.days.reduce((sum, day) => sum + (day.aerobic && day.minutes ? day.minutes : 0), 0);
}

/** The plan with enough minutes added to reach `target`, or `null` when it already does. */
export function topUpCardio(plan: UserPlan, target: number = GOALS.minutes): CardioTopUp | null {
  let deficit = target - aerobicMinutes(plan);
  if (deficit <= 0) return null;

  const extra = new Map<DayKey, number>();
  const give = (days: readonly UserPlanDay[], room: (day: UserPlanDay) => number, first = STEP): void => {
    let moved = true;
    while (deficit > 0 && moved) {
      moved = false;
      for (const day of days) {
        if (deficit <= 0) break;
        const already = extra.get(day.dayKey) ?? 0;
        const step = already === 0 ? first : STEP;
        if (already + step > room(day)) continue;
        extra.set(day.dayKey, already + step);
        deficit -= step;
        moved = true;
      }
    }
  };

  const cardioDays = plan.days.filter((day) => day.type !== 'rest' && day.aerobic && (day.minutes ?? 0) > 0);
  const strengthDays = plan.days.filter((day) => day.type === 'strength');
  const restDays = plan.days.filter((day) => day.type === 'rest');

  give(cardioDays, (day) => MAX_CARDIO_DAY - (day.minutes ?? 0));
  give(strengthDays, () => MAX_FINISHER, MIN_FINISHER);
  give(restDays, () => MAX_WALK, MIN_WALK);

  if (extra.size === 0) return null;

  const changes: string[] = [];
  const days = plan.days.map((day) => {
    const added = extra.get(day.dayKey);
    if (!added) return day;

    const name = DAY_NAMES[day.dayKey];
    if (day.type === 'strength') {
      changes.push(`${name}: ${added} min easy cardio after the lifts`);
      return {
        ...day,
        type: 'mixed' as const,
        aerobic: true,
        minutes: added,
        ...(day.modality || day.modalityStations?.length ? {} : { modality: FINISHER_MODALITY }),
        outline: [...day.outline, `Finish with ${added} minutes of easy cardio`],
      };
    }

    if (day.type === 'rest') {
      changes.push(`${name}: ${added} min easy walk`);
      return {
        ...day,
        type: 'duration' as const,
        label: day.label && day.label.toLowerCase() !== 'rest' ? day.label : 'Easy walk',
        aerobic: true,
        minutes: added,
        modality: WALK_MODALITY,
        outline: [
          `Walk for ${added} minutes at a pace you could hold a conversation at`,
          'Keep it easy — this is recovery',
        ],
      };
    }

    const minutes = (day.minutes ?? 0) + added;
    changes.push(`${name}: ${day.minutes ?? 0} → ${minutes} min`);
    return { ...day, minutes };
  });

  const total = [...extra.values()].reduce((sum, minutes) => sum + minutes, 0);
  return { plan: { ...plan, days }, added: total, changes };
}
