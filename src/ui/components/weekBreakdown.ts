import type { DayKey, Exercise, UserPlan } from '@/types';
import { DAY_NAMES, PLAN, PLAN_ORDER } from '@/data/plan';
import { resolveExercise } from '@/data/catalogue';
import { stationName } from '@/data/equipment';
import { isCustomExerciseId } from '@/domain/planFormat';
import { div, el, text } from '../dom';

/**
 * A week, one row per day, each opening to what that day asks for.
 *
 * Shared by the review of a proposed plan and the list of saved ones: choosing
 * between workout plans, or deciding whether to accept one, both come down to
 * the same question — what would I actually be doing on Tuesday — and a label
 * like "Push + Legs" does not answer it.
 */

/** One day, in the shape both kinds of plan reduce to. */
export interface BreakdownDay {
  readonly dayKey: DayKey;
  readonly label: string;
  /** The line under the label. */
  readonly sub: string;
  readonly rest: boolean;
  readonly minutes?: number;
  /** Where the cardio is done, in words. */
  readonly where: string;
  readonly outline: readonly string[];
  readonly note: string;
  readonly movements: readonly Exercise[];
}

/**
 * Days opened for a closer look, so a re-render — a sync landing, a button
 * elsewhere — does not snap them shut under the reader.
 */
const openDays = new Set<string>();

/** `scope` keeps one plan's open days apart from another's. */
export function renderWeekDays(scope: string, days: readonly BreakdownDay[]): HTMLElement {
  return el(
    'ul',
    { class: 'gen__days' },
    days.map((day) => renderDay(scope, day)),
  );
}

/** A proposed or saved plan's days, in the order it lists them. */
export function daysOfPlan(plan: UserPlan): BreakdownDay[] {
  return plan.days.map((day) => ({
    dayKey: day.dayKey,
    label: day.label,
    sub: day.sub || describeDay(day.type, day.minutes),
    rest: day.type === 'rest',
    ...(day.minutes ? { minutes: day.minutes } : {}),
    where: day.modality ?? (day.modalityStations ?? []).map(stationName).join(', '),
    outline: day.outline,
    note: day.note,
    movements: (day.exerciseIds ?? [])
      .map((id) => resolveExercise(id, { plan }))
      .filter((exercise): exercise is Exercise => exercise !== undefined),
  }));
}

/** The starter workout plan's days, Monday first like its own screens. */
export function daysOfStarter(): BreakdownDay[] {
  return PLAN_ORDER.map((key) => {
    const day = PLAN[key];
    return {
      dayKey: key,
      label: day.label,
      sub: day.sub,
      rest: false,
      ...(day.minutes ? { minutes: day.minutes } : {}),
      where: (day.modalityStations ?? []).map(stationName).join(', '),
      outline: day.outline,
      note: day.note,
      movements: day.exercises ?? [],
    };
  });
}

function describeDay(type: string, minutes: number | undefined): string {
  if (type === 'rest') return 'Rest';
  return minutes ? `${type} · ${minutes} min` : type;
}

function renderDay(scope: string, day: BreakdownDay): HTMLElement {
  const headline = [
    el('span', { class: 'gen__daykey', text: DAY_NAMES[day.dayKey] }),
    div('gen__dayhead', [text('gen__daylabel', day.label), text('gen__daysub', day.sub)]),
  ];

  // Rest days have nothing to open.
  if (day.rest) return el('li', { class: 'gen__day' }, [div('gen__summary', headline)]);

  const key = `${scope}:${day.dayKey}`;
  return el('li', { class: 'gen__day' }, [
    el(
      'details',
      {
        class: 'gen__detail',
        attrs: { open: openDays.has(key) },
        on: {
          toggle: (event) => {
            if ((event.target as HTMLDetailsElement).open) openDays.add(key);
            else openDays.delete(key);
          },
        },
      },
      [
        el('summary', { class: 'gen__summary' }, [
          ...headline,
          el('span', { class: 'gen__chevron', text: '▾', attrs: { 'aria-hidden': 'true' } }),
        ]),
        renderBreakdown(day),
      ],
    ),
  ]);
}

function renderBreakdown(day: BreakdownDay): HTMLElement {
  return div('gen__breakdown', [
    day.outline.length > 0
      ? el(
          'ol',
          { class: 'gen__steps' },
          day.outline.map((step) => el('li', { text: step })),
        )
      : null,

    day.minutes ? text('gen__cardio', `${day.minutes} min${day.where ? ` · ${day.where}` : ''}`) : null,

    day.movements.length > 0
      ? el(
          'ul',
          { class: 'gen__moves' },
          day.movements.map((exercise) => renderMovement(exercise)),
        )
      : null,

    day.note ? text('gen__daysub', day.note) : null,
  ]);
}

function renderMovement(exercise: Exercise): HTMLElement {
  const unit = exercise.repMetric === 'seconds' ? ' sec' : '';
  const range = exercise.repRange.replace(/ sec$/, '');
  const equipment =
    exercise.equipment ??
    (exercise.stations ?? [])
      .slice(0, 2)
      .map((station) => stationName(station.stationId))
      .join(' or ');

  return el('li', { class: 'gen__move' }, [
    div('gen__movehead', [
      el('span', { class: 'gen__movename', text: exercise.name }),
      isCustomExerciseId(exercise.id) ? el('span', { class: 'swap__tag', text: 'New' }) : null,
      el('span', { class: 'gen__movesets', text: `${exercise.sets} × ${range}${unit}` }),
    ]),
    exercise.summary ? text('gen__daysub', exercise.summary) : null,
    equipment ? text('gen__daysub', equipment) : null,
  ]);
}
