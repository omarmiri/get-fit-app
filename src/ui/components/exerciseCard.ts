import type { Exercise, LoggedSet, Preferences, SetEffort, WeightUnit } from '@/types';
import type { Recommendation } from '@/domain/progression';
import { ZONE_LABEL, getStation } from '@/data/equipment';
import { formatShortDate } from '@/domain/dates';
import { clampReps, clampWeight } from '@/domain/limits';
import { STEP_BY_UNIT, UNIT_LABEL, formatWeightValue, setWeightIn } from '@/domain/units';
import type { PreviousPerformance } from '@/state/selectors';
import { card, div, el, eyebrow, text } from '../dom';
import { createStepper } from './stepper';
import { renderExerciseMedia } from './exerciseMedia';
import { renderStationSwap } from './stationSwap';

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
  readonly prefs: Preferences;
  /** The station currently chosen for this exercise. */
  readonly stationId: string | undefined;
  /** Whether the swap sheet is open. Held by the view so a re-render keeps it. */
  readonly swapOpen: boolean;
  /** Stepper values typed but not yet logged, preserved across re-renders. */
  readonly draft: { weight: number; reps: number } | undefined;
  readonly onDraftChange: (draft: { weight: number; reps: number }) => void;
  /** What the progression engine suggests, or null when it has nothing to say. */
  readonly recommendation: Recommendation | null;
  /** Text for the log button — a set number, or a circuit round. */
  readonly logLabel: string;
  /** True once this movement has met its target for the session. */
  readonly targetMet: boolean;
  /** Effort selected for the set about to be logged. */
  readonly effort: SetEffort | undefined;
  readonly onEffortChange: (effort: SetEffort | undefined) => void;
  readonly onLogWithEffort: (weight: number, reps: number, effort: SetEffort | undefined) => void;
  readonly onUndo: () => void;
  readonly onToggleSwap: () => void;
  /** Chose a different station, optionally with a converted starting load. */
  readonly onChooseStation: (stationId: string, suggestedWeight: number | null) => void;
  readonly onToggleMissingStation: (stationId: string, missing: boolean) => void;
}

export function renderExerciseCard(options: ExerciseCardOptions): HTMLElement {
  const { exercise, logged, previous, unit } = options;
  const timed = exercise.repMetric === 'seconds';

  const seed = seedValues(options);

  // Report every change upward so the value survives the next render.
  const publishDraft = (): void =>
    options.onDraftChange({ weight: weightStepper.getValue(), reps: repsStepper.getValue() });

  const weightStepper = createStepper({
    label: `Weight (${UNIT_LABEL[unit]})`,
    initial: seed.weight,
    step: STEP_BY_UNIT[unit],
    clamp: clampWeight,
    onChange: () => publishDraft(),
  });

  const repsStepper = createStepper({
    label: timed ? 'Seconds' : 'Reps',
    initial: seed.reps,
    step: timed ? 5 : 1,
    clamp: clampReps,
    onChange: () => publishDraft(),
  });

  const logButton = el('button', {
    // Once the target is met the extra set is optional, so the button steps
    // back visually rather than continuing to look like the next required
    // action. Prompting "Log set 4" after three of three read as an instruction.
    class: options.targetMet ? 'button button--ghost' : 'button button--primary',
    text: options.targetMet ? 'Log an extra set' : options.logLabel,
    attrs: { type: 'button' },
    on: {
      click: () => options.onLogWithEffort(weightStepper.getValue(), repsStepper.getValue(), options.effort),
    },
  });

  return card([
    text('exercise__name', exercise.name),
    exercise.summary ? text('exercise__summary', exercise.summary) : null,
    text('exercise__meta', describeTarget(exercise)),
    renderStationBar(options),
    options.swapOpen
      ? renderStationSwap({
          exercise,
          prefs: options.prefs,
          unit,
          // Convert from what is in the stepper right now, not from history —
          // the user may have already adjusted it for today.
          currentWeight: weightStepper.getValue(),
          selectedStationId: options.stationId,
          onChoose: (stationId, suggested) => {
            if (suggested !== null) weightStepper.setValue(suggested);
            options.onChooseStation(stationId, suggested);
          },
          onToggleMissing: options.onToggleMissingStation,
          onClose: options.onToggleSwap,
        })
      : null,
    renderExerciseMedia(exercise),
    renderSetDots(exercise, logged.length),

    div('steppers', [weightStepper.element, text('steppers__times mono', '×'), repsStepper.element]),

    renderRecommendation(options),
    exercise.repMetric === 'seconds' ? null : renderEffortPicker(options),

    options.targetMet
      ? div('donebadge', [
          el('span', { class: 'donebadge__tick', text: '✓', attrs: { 'aria-hidden': 'true' } }),
          text('donebadge__text', `${logged.length} of ${exercise.sets} done — nothing more needed here.`),
        ])
      : null,

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

  // A value the user is part-way through entering always wins.
  if (options.draft) return options.draft;

  // Before the first set of the session, open on what progression suggests.
  if (logged.length === 0 && options.recommendation) {
    return { weight: options.recommendation.weight, reps: options.recommendation.reps };
  }

  const source = logged.at(-1) ?? previous?.sets.at(-1) ?? null;
  if (!source) return { weight: 0, reps: exercise.defaultReps };

  return {
    weight: setWeightIn(source, unit),
    reps: source.reps > 0 ? source.reps : exercise.defaultReps,
  };
}

/**
 * The station line: where you are doing this, and the way out when it is taken.
 *
 * Renders nothing for movements with no station options, so bodyweight work
 * does not carry a pointless "swap" affordance.
 */
function renderStationBar(options: ExerciseCardOptions): HTMLElement | null {
  if (!options.exercise.stations || options.exercise.stations.length === 0) return null;

  const station = options.stationId === undefined ? undefined : getStation(options.stationId);
  const alternatives = options.exercise.stations.length - 1;

  return div('stationbar', [
    div('stationbar__at', [
      el('span', { class: 'stationbar__label', text: 'At' }),
      el('span', { class: 'stationbar__name', text: station?.name ?? 'Any station' }),
      station ? el('span', { class: 'stationbar__zone', text: ZONE_LABEL[station.zone] }) : null,
    ]),
    alternatives > 0
      ? el('button', {
          class: options.swapOpen ? 'stationbar__swap is-open' : 'stationbar__swap',
          text: options.swapOpen ? 'Close' : 'Taken?',
          attrs: {
            type: 'button',
            'aria-expanded': options.swapOpen,
            'aria-label': options.swapOpen
              ? 'Close alternative stations'
              : `Show ${alternatives} alternative stations`,
          },
          on: { click: options.onToggleSwap },
        })
      : null,
  ]);
}

/**
 * The progression suggestion and why it was made.
 *
 * Shown only when it differs from what the steppers already hold — repeating
 * the number that is on screen adds noise without adding information.
 */
function renderRecommendation(options: ExerciseCardOptions): HTMLElement | null {
  const recommendation = options.recommendation;
  if (!recommendation) return null;
  // Once the first set of the session is logged, the suggestion has been acted
  // on; showing it against later sets would argue with what you just did.
  if (options.logged.length > 0) return null;

  return div(`reco reco--${recommendation.kind}`, [
    el('span', { class: 'reco__icon', text: iconFor(recommendation.kind), attrs: { 'aria-hidden': 'true' } }),
    text('reco__text', recommendation.reason),
  ]);
}

function iconFor(kind: Recommendation['kind']): string {
  switch (kind) {
    case 'add-weight':
      return '▲';
    case 'deload':
      return '▼';
    case 'add-reps':
      return '+';
    case 'repeat':
      return '=';
    case 'opening':
      return '★';
  }
}

/** How did that set feel? Three options, no default, one tap. */
function renderEffortPicker(options: ExerciseCardOptions): HTMLElement {
  const choices: readonly { value: SetEffort; label: string }[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'right', label: 'Just right' },
    { value: 'hard', label: 'Hard' },
  ];

  return div('effort', [
    div('effort__label', [
      el('span', { class: 'eyebrow', text: 'How did that set feel' }),
      el('span', { class: 'effort__optional', text: 'optional' }),
    ]),
    el(
      'div',
      { class: 'choices__row', attrs: { role: 'group', 'aria-label': 'How did that set feel' } },
      choices.map((choice) =>
        el('button', {
          class: 'choices__button effort__button',
          text: choice.label,
          attrs: { type: 'button', 'aria-pressed': options.effort === choice.value },
          // Tapping the selected option again clears it.
          on: {
            click: () => options.onEffortChange(options.effort === choice.value ? undefined : choice.value),
          },
        }),
      ),
    ),
  ]);
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
