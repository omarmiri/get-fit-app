import type { Effort, PlanDay, Session } from '@/types';
import { clampMinutes } from '@/domain/limits';
import { card, div, el, eyebrow } from '../dom';

/**
 * Minutes, modality and perceived effort for time-based sessions.
 *
 * Shown on cardio, pool and recovery days, and alongside the core work on mixed
 * days.
 */

const EFFORTS: readonly Effort[] = ['Easy', 'Moderate', 'Hard'];

export interface DurationCardOptions {
  readonly day: PlanDay;
  /** The in-progress session, if one has been started. */
  readonly active: Session | null;
  readonly onMinutes: (minutes: number) => void;
  readonly onModality: (modality: string) => void;
  readonly onEffort: (effort: Effort) => void;
}

export function renderDurationCard(options: DurationCardOptions): HTMLElement {
  const { day, active } = options;
  const minutes = active?.minutes ?? day.minutes ?? 0;

  const minutesInput = el('input', {
    class: 'bigfield__input mono',
    attrs: {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': 'Session minutes',
      value: String(minutes),
    },
    on: {
      input: (event) => options.onMinutes(clampMinutes((event.target as HTMLInputElement).value)),
      blur: (event) => {
        const input = event.target as HTMLInputElement;
        input.value = String(clampMinutes(input.value));
      },
    },
  });

  return card([
    eyebrow(day.type === 'mixed' ? 'Cardio portion' : 'Session'),

    div('bigfield', [minutesInput, el('span', { class: 'bigfield__unit', text: 'minutes' })]),

    day.modalities
      ? renderChoices('Activity', day.modalities, active?.modality ?? null, options.onModality)
      : null,

    renderChoices('How hard did it feel', EFFORTS, active?.effort ?? null, (value) =>
      options.onEffort(value as Effort),
    ),
  ]);
}

/**
 * A row of single-select toggle buttons.
 *
 * `aria-pressed` rather than a radio group: choosing the same option again
 * clears it, which radios cannot express.
 */
function renderChoices(
  label: string,
  choices: readonly string[],
  selected: string | null,
  onChoose: (value: string) => void,
): HTMLElement {
  return div('choices', [
    eyebrow(label),
    el(
      'div',
      { class: 'choices__row', attrs: { role: 'group', 'aria-label': label } },
      choices.map((choice) =>
        el('button', {
          class: 'choices__button',
          text: choice,
          attrs: { type: 'button', 'aria-pressed': choice === selected },
          on: { click: () => onChoose(choice) },
        }),
      ),
    ),
  ]);
}
