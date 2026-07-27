import type { Exercise, LoggedSet, WeightUnit } from '@/types';
import { formatShortDate } from '@/domain/dates';
import { clampReps, clampWeight } from '@/domain/limits';
import { STEP_BY_UNIT, UNIT_LABEL, formatWeightValue, setWeightIn } from '@/domain/units';
import type { PreviousPerformance } from '@/state/selectors';
import { card, div, el, eyebrow, text } from '../dom';
import { createStepper } from './stepper';
import { renderExerciseMedia } from './exerciseMedia';

/**
 * The set-logging card: one exercise, its cues, and the controls to record a
 * working set.
 */

export interface ExerciseCardOptions {
  readonly exercise: Exercise;
  /** Sets already logged for this exercise in the current session. */
  readonly logged: readonly LoggedSet[];
  /** The last time this exercise was performed, used to prefill the steppers. */
  readonly previous: PreviousPerformance | null;
  readonly unit: WeightUnit;
  readonly onLog: (weight: number, reps: number) => void;
  readonly onUndo: () => void;
}

export function renderExerciseCard(options: ExerciseCardOptions): HTMLElement {
  const { exercise, logged, previous, unit } = options;
  const timed = exercise.repMetric === 'seconds';

  const seed = seedValues(options);

  const weightStepper = createStepper({
    label: `Weight (${UNIT_LABEL[unit]})`,
    initial: seed.weight,
    step: STEP_BY_UNIT[unit],
    clamp: clampWeight,
  });

  const repsStepper = createStepper({
    label: timed ? 'Seconds' : 'Reps',
    initial: seed.reps,
    step: timed ? 5 : 1,
    clamp: clampReps,
  });

  const logButton = el('button', {
    class: 'button button--primary',
    text: `Log set ${logged.length + 1}`,
    attrs: { type: 'button' },
    on: {
      click: () => options.onLog(weightStepper.getValue(), repsStepper.getValue()),
    },
  });

  return card([
    text('exercise__name', exercise.name),
    text('exercise__meta', describeTarget(exercise)),
    renderExerciseMedia(exercise),
    renderSetDots(exercise, logged.length),

    div('steppers', [weightStepper.element, text('steppers__times mono', '×'), repsStepper.element]),

    exercise.loaded
      ? null
      : text('exercise__hint', 'Bodyweight movement — leave the weight at zero unless you add load.'),

    previous ? renderSetChips(eyebrow(formatShortDate(previous.date)), previous.sets, unit, false) : null,
    logged.length > 0 ? renderSetChips(eyebrow('Today'), logged, unit, true) : null,

    logButton,
    logged.length > 0
      ? el('button', {
          class: 'button button--ghost',
          text: 'Undo last set',
          attrs: { type: 'button' },
          on: { click: options.onUndo },
        })
      : null,

    renderCues(exercise),
  ]);
}

/**
 * Choose the values the steppers open on.
 *
 * Preference order is: what was logged a moment ago in this session, then what
 * was logged last time, then the exercise's own defaults. Repeating the
 * previous load is the overwhelmingly common case, so this saves most of the
 * tapping in a session.
 */
function seedValues(options: ExerciseCardOptions): { weight: number; reps: number } {
  const { exercise, logged, previous, unit } = options;

  const source = logged.at(-1) ?? previous?.sets.at(-1) ?? null;
  if (!source) return { weight: 0, reps: exercise.defaultReps };

  return {
    weight: setWeightIn(source, unit),
    reps: source.reps > 0 ? source.reps : exercise.defaultReps,
  };
}

function describeTarget(exercise: Exercise): string {
  const target = `${exercise.sets} × ${exercise.repRange}`;
  return exercise.alternative ? `${target}  ·  or ${exercise.alternative}` : target;
}

/** One pip per target set, filled as sets are logged. */
function renderSetDots(exercise: Exercise, completed: number): HTMLElement {
  const dots = el('div', {
    class: 'setdots',
    attrs: {
      role: 'img',
      'aria-label': `${completed} of ${exercise.sets} sets logged`,
    },
  });

  for (let i = 0; i < exercise.sets; i += 1) {
    dots.appendChild(el('i', { class: i < completed ? 'is-done' : '' }));
  }

  // Sets beyond the target still count — show them rather than hiding the work.
  for (let i = exercise.sets; i < completed; i += 1) {
    dots.appendChild(el('i', { class: 'is-done is-extra' }));
  }

  return dots;
}

function renderSetChips(
  label: HTMLElement,
  sets: readonly LoggedSet[],
  unit: WeightUnit,
  current: boolean,
): HTMLElement {
  const chips = sets.map((set) => {
    const weight = setWeightIn(set, unit);
    const body = weight > 0 ? `${formatWeightValue(weight, unit)}×${set.reps}` : `${set.reps}`;
    return el('span', { class: `chip mono${current ? ' chip--now' : ''}`, text: body });
  });

  return div('setline', [label, ...chips]);
}

function renderCues(exercise: Exercise): HTMLElement {
  const rows: [string, string, string][] = [
    ['Setup', exercise.cues.setup, ''],
    ['Do', exercise.cues.execute, ''],
    ['Avoid', exercise.cues.avoid, 'cue--warn'],
  ];

  const details = el('details', { class: 'cues' }, [
    el('summary', {}, [
      el('span', { text: 'Setup and cues' }),
      el('span', { class: 'cues__chevron', attrs: { 'aria-hidden': 'true' }, text: '▾' }),
    ]),
    ...rows.map(([key, body, modifier]) =>
      div(`cue ${modifier}`.trim(), [text('cue__key', key), text('cue__body', body)]),
    ),
    ...renderTips(exercise),
  ]);

  return details;
}

/** Extra coaching notes. Empty for most exercises; a roadmap growth point. */
function renderTips(exercise: Exercise): HTMLElement[] {
  if (!exercise.tips || exercise.tips.length === 0) return [];

  return [
    div('cue', [
      text('cue__key', 'Notes'),
      el(
        'ul',
        { class: 'cue__body cue__list' },
        exercise.tips.map((tip) => el('li', { text: tip })),
      ),
    ]),
  ];
}
