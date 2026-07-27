import type { FitnessLevel, UserProfile, WeightUnit } from '@/types';
import { todayIso } from '@/domain/dates';
import { clampNumber } from '@/domain/limits';
import { UNIT_LABEL } from '@/domain/units';
import { card, div, el, eyebrow, text } from '../dom';

/**
 * One-time setup, so the first session opens at a defensible weight instead of
 * zero.
 *
 * Three questions and a skip button. Everything here is optional — the app
 * works fine without it, you just dial in your own starting weights. That is
 * said on screen rather than implied, because a setup form that looks mandatory
 * is a setup form people abandon the app at.
 *
 * Only age, bodyweight and experience are asked. They are the fields that
 * change the estimate enough to justify asking; anything more would be
 * collecting personal detail for a number that is a rough floor anyway.
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
  const draft: { age: number; bodyweight: number; level: FitnessLevel | null } = {
    age: 0,
    bodyweight: 0,
    level: null,
  };

  const saveButton = el('button', {
    class: 'button button--primary',
    text: 'Save and start',
    attrs: { type: 'button' },
  });

  const refresh = (): void => {
    const ready = draft.age > 0 && draft.bodyweight > 0 && draft.level !== null;
    saveButton.toggleAttribute('disabled', !ready);
    saveButton.setAttribute('aria-disabled', String(!ready));
  };

  saveButton.addEventListener('click', () => {
    if (draft.level === null || draft.age <= 0 || draft.bodyweight <= 0) return;
    options.onSave({
      age: draft.age,
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
      eyebrow('One-time setup'),
      el('h2', { class: 'onboard__title', text: 'Let’s pick a safe starting weight' }),
      text(
        'prose',
        'Three questions, once. The app uses them only to suggest an opening weight for each machine — deliberately on the light side, so your first set is never the one that hurts you. Nothing leaves this device, and you can skip this and set your own weights.',
      ),

      renderNumberField('Age', 'years', 'numeric', (value) => {
        draft.age = clampNumber(value, { min: 10, max: 100 }, 0);
        refresh();
      }),

      renderNumberField('Bodyweight', UNIT_LABEL[options.unit], 'decimal', (value) => {
        draft.bodyweight = clampNumber(value, { min: 50, max: 700 }, 0);
        refresh();
      }),

      div('onboard__group', [eyebrow('Experience'), div('levelgrid', levelButtons)]),

      saveButton,

      el('button', {
        class: 'button button--ghost',
        text: 'Skip — I’ll set my own',
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
