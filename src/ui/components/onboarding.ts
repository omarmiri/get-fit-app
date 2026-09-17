import type { FitnessLevel, UserProfile, WeightUnit } from '@/types';
import { todayIso } from '@/domain/dates';
import { clampNumber } from '@/domain/limits';
import { UNIT_LABEL } from '@/domain/units';
import { card, div, el, eyebrow, text } from '../dom';

/**
 * Optional detail, for anyone who would rather give it than calibrate by feel.
 *
 * This used to stand between the welcome screen and the first session: three
 * questions, before anybody had lifted anything, to produce a number the app
 * rounds down and abandons after one logged set. It is on the Plan tab now,
 * where someone has gone looking for it, and the first session instead opens
 * from a deliberately light default and asks one question at the machine.
 *
 * Age is gone. It moved the estimate less than the rounding already does, and
 * it was the field that made a training log feel like a medical intake.
 */

const LEVELS: readonly { value: FitnessLevel; label: string; hint: string }[] = [
  { value: 'new', label: 'New to this', hint: 'Little or no lifting in the last year' },
  { value: 'returning', label: 'Returning', hint: 'Trained before, coming back after a break' },
  { value: 'experienced', label: 'Experienced', hint: 'Lifting regularly and know your numbers' },
];

export interface OnboardingOptions {
  readonly unit: WeightUnit;
  readonly onSave: (profile: UserProfile) => void;
  readonly onSkip: () => void;
}

export function renderOnboarding(options: OnboardingOptions): HTMLElement {
  const draft: { bodyweight: number; level: FitnessLevel | null } = {
    bodyweight: 0,
    level: null,
  };

  const saveButton = el('button', {
    class: 'button button--primary',
    text: 'Save these details',
    attrs: { type: 'button' },
  });

  const refresh = (): void => {
    const ready = draft.bodyweight > 0 && draft.level !== null;
    saveButton.toggleAttribute('disabled', !ready);
    saveButton.setAttribute('aria-disabled', String(!ready));
  };

  saveButton.addEventListener('click', () => {
    if (draft.level === null || draft.bodyweight <= 0) return;
    options.onSave({
      bodyweight: draft.bodyweight,
      bodyweightUnit: options.unit,
      level: draft.level,
      recordedOn: todayIso(),
    });
  });

  const levelButtons = LEVELS.map((level) =>
    el(
      'button',
      {
        class: 'levelcard',
        attrs: { type: 'button', 'aria-pressed': false },
        on: {
          click: (event) => {
            draft.level = level.value;
            const row = (event.currentTarget as HTMLElement).parentElement;
            for (const button of row?.querySelectorAll('.levelcard') ?? []) {
              button.setAttribute('aria-pressed', String(button === event.currentTarget));
            }
            refresh();
          },
        },
      },
      [text('levelcard__label', level.label), text('levelcard__hint', level.hint)],
    ),
  );

  const result = card(
    [
      eyebrow('Optional'),
      el('h2', { class: 'onboard__title', text: 'Starting weights, from your numbers' }),
      text(
        'prose',
        'Two questions. The app uses them only to suggest an opening weight the first time you do a movement — deliberately on the light side, so your first set is never the one that hurts you. Nothing leaves this device, and skipping it costs nothing: the app already opens from a conservative default and asks you at the machine whether it looks right.',
      ),

      renderNumberField('Bodyweight', UNIT_LABEL[options.unit], 'decimal', (value) => {
        draft.bodyweight = clampNumber(value, { min: 50, max: 700 }, 0);
        refresh();
      }),

      div('onboard__group', [eyebrow('Experience'), div('levelgrid', levelButtons)]),

      saveButton,

      el('button', {
        class: 'button button--ghost',
        text: 'Not now',
        attrs: { type: 'button' },
        on: { click: options.onSkip },
      }),

      text(
        'onboard__disclaimer',
        'Suggested weights are a conservative starting point, not a prescription. If a movement is new to you, do the first set lighter than suggested. Stop if anything hurts.',
      ),
    ],
    'onboard',
  );

  refresh();
  return result;
}

function renderNumberField(
  label: string,
  suffix: string,
  mode: 'numeric' | 'decimal',
  onChange: (value: string) => void,
): HTMLElement {
  return div('onboard__group', [
    eyebrow(label),
    div('onboard__field', [
      el('input', {
        class: 'onboard__input mono',
        attrs: {
          type: 'text',
          inputmode: mode,
          autocomplete: 'off',
          'aria-label': `${label} in ${suffix}`,
          placeholder: '—',
        },
        on: { input: (event) => onChange((event.target as HTMLInputElement).value) },
      }),
      el('span', { class: 'onboard__suffix', text: suffix }),
    ]),
  ]);
}
