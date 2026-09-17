import type { Exercise, LoggedSet, Preferences, WeightUnit } from '@/types';
import type { Recommendation, SetAdjustment } from '@/domain/progression';
import { adjustAfterSet } from '@/domain/progression';
import { ZONE_LABEL, getStation } from '@/data/equipment';
import { formatShortDate } from '@/domain/dates';
import { clampReps, clampWeight } from '@/domain/limits';
import { STEP_BY_UNIT, UNIT_LABEL, formatWeightValue, setWeightIn } from '@/domain/units';
import type { PreviousPerformance } from '@/state/selectors';
import { div, el, text } from '../dom';
import { createFocusStepper } from './focusStepper';
import { renderStationSwap } from './stationSwap';

/**
 * The movement panel on the mid-workout screen.
 *
 * Mid-set the screen has two jobs: show the numbers about to be done, and take
 * one tap to record them. Everything the old card carried that belongs to the
 * two minutes before the session or the ten seconds after it — the outline, the
 * cues, the effort question, the weekly goals, the running clock as its own
 * card — has moved behind the header's reference sheet, to the rest screen, or
 * to History. What is left fits above the fold on a small phone with the action
 * in the bottom third, which is the whole point.
 */

export interface FocusCardOptions {
  readonly exercise: Exercise;
  /** Sets already logged for this exercise in the current session. */
  readonly logged: readonly LoggedSet[];
  readonly previous: PreviousPerformance | null;
  readonly unit: WeightUnit;
  readonly prefs: Preferences;
  readonly stationId: string | undefined;
  readonly swapOpen: boolean;
  readonly draft: { weight: number; reps: number } | undefined;
  readonly onDraftChange: (draft: { weight: number; reps: number }) => void;
  readonly recommendation: Recommendation | null;
  /** Text for the action, e.g. `Log set 3` or a circuit round. */
  readonly logLabel: string;
  /** True once this movement has met its target for the session. */
  readonly targetMet: boolean;
  /** True once every movement has, which turns the action into "finish". */
  readonly sessionComplete: boolean;
  /**
   * Ask whether the opening weight is about right, or null once it has been.
   *
   * This is the whole of what first run used to ask, moved to the only place
   * it can be answered honestly: standing at the machine, looking at the
   * number. One answer moves every other opening with it.
   */
  readonly calibrate: { readonly weight: number } | null;
  readonly onCalibrate: (verdict: 'light' | 'right' | 'heavy') => void;
  readonly onLog: (weight: number, reps: number) => void;
  readonly onFinish: () => void;
  readonly onToggleSwap: () => void;
  readonly onChooseStation: (stationId: string, suggestedWeight: number | null) => void;
  readonly onToggleMissingStation: (stationId: string, missing: boolean) => void;
}

export function renderFocusCard(options: FocusCardOptions): HTMLElement {
  const { exercise, logged, unit } = options;
  const timed = exercise.repMetric === 'seconds';

  const lastToday = logged.at(-1) ?? null;
  const ramp = lastToday
    ? adjustAfterSet(exercise, setWeightIn(lastToday, unit), lastToday.effort, unit)
    : null;

  const seed = seedValues(options, ramp);

  /* ------------------------------------------------------------- readout */

  const weightValue = el('span', { class: 'readout__value mono' });
  const repsValue = el('span', { class: 'readout__reps mono' });

  const paint = (weight: number, reps: number): void => {
    weightValue.textContent = formatWeightValue(weight, unit);
    repsValue.textContent = String(reps);
  };

  const publish = (): void => {
    const weight = weightStepper.getValue();
    const reps = repsStepper.getValue();
    paint(weight, reps);
    options.onDraftChange({ weight, reps });
  };

  const weightStepper = createFocusStepper({
    label: 'Weight',
    hint: `${formatWeightValue(STEP_BY_UNIT[unit], unit)} ${UNIT_LABEL[unit]} steps · hold to type`,
    initial: seed.weight,
    step: STEP_BY_UNIT[unit],
    clamp: clampWeight,
    onChange: publish,
  });

  const repsStepper = createFocusStepper({
    label: timed ? 'Seconds' : 'Reps',
    hint: timed ? `target ${exercise.repRange}s` : `target ${exercise.repRange}`,
    initial: seed.reps,
    step: timed ? 5 : 1,
    clamp: clampReps,
    onChange: publish,
  });

  paint(seed.weight, seed.reps);

  // Tapping the number is the discoverable way into the keypad; holding a
  // stepper is the same door for a thumb already down there.
  const readout = el(
    'button',
    {
      class: 'readout',
      attrs: {
        type: 'button',
        'aria-label': `${weightValue.textContent ?? ''} ${UNIT_LABEL[unit]} by ${repsValue.textContent ?? ''}. Edit`,
      },
      on: { click: () => weightStepper.openKeypad() },
    },
    [
      weightValue,
      exercise.loaded ? el('span', { class: 'readout__unit', text: UNIT_LABEL[unit] }) : null,
      el('span', { class: 'readout__times', text: '×', attrs: { 'aria-hidden': 'true' } }),
      repsValue,
    ],
  );

  /* -------------------------------------------------------------- action */

  const action = options.sessionComplete
    ? el('button', {
        class: 'button button--primary button--log',
        text: 'Finish session',
        attrs: { type: 'button' },
        on: { click: options.onFinish },
      })
    : el('button', {
        class: options.targetMet ? 'button button--ghost button--log' : 'button button--primary button--log',
        text: options.targetMet ? 'Log an extra set' : options.logLabel,
        attrs: { type: 'button' },
        on: { click: () => options.onLog(weightStepper.getValue(), repsStepper.getValue()) },
      });

  return div('focuscard', [
    el('h1', { class: 'focuscard__name', text: exercise.name }),
    renderMeta(options),
    options.swapOpen
      ? renderStationSwap({
          exercise,
          prefs: options.prefs,
          unit,
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
    readout,
    renderNote(options, ramp),
    renderCalibration(options),
    div('fsteps', [weightStepper.element, repsStepper.element]),
    options.sessionComplete ? text('focuscard__done', 'Every movement has hit its target.') : null,
    action,
  ]);
}

/**
 * "First time on this machine — is 95 lb about right?"
 *
 * Screen 02 of the old first run asked age, bodyweight and experience before
 * anyone had lifted anything, to produce a number the app rounds down and
 * abandons after one logged set. This asks the same question where the answer
 * is knowable, and self-dismisses the moment there is a real set to progress
 * from.
 */
function renderCalibration(options: FocusCardOptions): HTMLElement | null {
  const calibrate = options.calibrate;
  if (!calibrate) return null;

  const load = `${formatWeightValue(calibrate.weight, options.unit)} ${UNIT_LABEL[options.unit]}`;

  const choices: readonly { verdict: 'light' | 'right' | 'heavy'; label: string }[] = [
    { verdict: 'light', label: 'Too light' },
    { verdict: 'right', label: 'Right' },
    { verdict: 'heavy', label: 'Too heavy' },
  ];

  return div('calibrate', [
    text('calibrate__ask', `First time on this machine — is ${load} about right?`),
    el(
      'div',
      { class: 'choices__row', attrs: { role: 'group', 'aria-label': 'Is this weight about right' } },
      choices.map((choice) =>
        el('button', {
          class: 'choices__button effort__button',
          text: choice.label,
          attrs: { type: 'button' },
          on: { click: () => options.onCalibrate(choice.verdict) },
        }),
      ),
    ),
    text(
      'calibrate__note',
      'Answered once. Every other opening weight shifts with it — or just change the number.',
    ),
  ]);
}

/**
 * Where you are in the movement, and where you are doing it.
 *
 * The station used to be its own bar with its own background and its own red
 * button — the third accent of equal weight on a screen that should have one.
 * It is a line of text now, and the way out when the machine is taken is the
 * same line, pressed.
 */
function renderMeta(options: FocusCardOptions): HTMLElement {
  const { exercise, logged } = options;
  const progress = `Set ${Math.min(logged.length + 1, exercise.sets)} / ${exercise.sets}`;
  const station = options.stationId === undefined ? undefined : getStation(options.stationId);
  const alternatives = (exercise.stations?.length ?? 0) - 1;

  const where = station ? `${station.name} · ${ZONE_LABEL[station.zone]}` : null;

  return div('focuscard__meta', [
    text('focuscard__set', options.targetMet ? `${logged.length} / ${exercise.sets} done` : progress),
    alternatives > 0
      ? el('button', {
          class: options.swapOpen ? 'focuscard__where is-open' : 'focuscard__where',
          text: options.swapOpen ? 'Close' : (where ?? 'Any station'),
          attrs: {
            type: 'button',
            'aria-expanded': options.swapOpen,
            'aria-label': options.swapOpen
              ? 'Close alternative stations'
              : `${where ?? 'Any station'}. Taken? Show ${alternatives} alternatives`,
          },
          on: { click: options.onToggleSwap },
        })
      : where
        ? text('focuscard__where is-static', where)
        : null,
  ]);
}

/**
 * The one line of context under the numbers.
 *
 * The full card stacked a progression note, a ramp note, an effort question and
 * two rows of set chips. Between two machines there is room for one sentence:
 * why the number on screen is the number on screen, and what was done against
 * it — today's sets if there are any, last time's if there are not.
 */
function renderNote(options: FocusCardOptions, ramp: SetAdjustment | null): HTMLElement | null {
  const parts: string[] = [];

  const reason = options.draft
    ? null
    : (ramp?.reason ?? (options.logged.length === 0 ? options.recommendation?.reason : null));
  if (reason) parts.push(reason);

  const history = describeSets(options);
  if (history) parts.push(history);

  if (parts.length === 0) return null;
  return text('focuscard__note', parts.join(' '));
}

function describeSets(options: FocusCardOptions): string | null {
  const { logged, previous, unit } = options;
  if (logged.length > 0) return `Today: ${joinSets(logged, unit)}`;
  if (previous && previous.sets.length > 0) {
    return `${formatShortDate(previous.date)}: ${joinSets(previous.sets, unit)}`;
  }
  return null;
}

function joinSets(sets: readonly LoggedSet[], unit: WeightUnit): string {
  return sets
    .map((set) => {
      const weight = setWeightIn(set, unit);
      return weight > 0 ? `${formatWeightValue(weight, unit)}×${set.reps}` : String(set.reps);
    })
    .join(', ');
}

/**
 * Choose the values the controls open on.
 *
 * Same rule as the full card: an uncommitted draft wins, then progression
 * before the first set, then the last set — ramped for how it felt — then last
 * time, then the exercise's own defaults.
 */
function seedValues(options: FocusCardOptions, ramp: SetAdjustment | null): { weight: number; reps: number } {
  const { exercise, logged, previous, unit } = options;

  if (options.draft) return options.draft;

  if (logged.length === 0 && options.recommendation) {
    return { weight: options.recommendation.weight, reps: options.recommendation.reps };
  }

  const source = logged.at(-1) ?? previous?.sets.at(-1) ?? null;
  if (!source) return { weight: 0, reps: exercise.defaultReps };

  return {
    weight: ramp?.weight ?? setWeightIn(source, unit),
    reps: source.reps > 0 ? source.reps : exercise.defaultReps,
  };
}
