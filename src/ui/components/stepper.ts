import { el } from '../dom';

/**
 * A labelled numeric field with minus/plus buttons.
 *
 * Used for weight and reps, which are entered one-handed, mid-set, on a phone.
 * The buttons are the primary control and the text field is the escape hatch,
 * so the buttons get the large tap targets and the field accepts free entry.
 */

export interface StepperOptions {
  readonly label: string;
  readonly initial: number;
  /** Increment applied by the +/- buttons. */
  readonly step: number;
  /** Applied to every value before it is stored or displayed. */
  readonly clamp: (value: unknown) => number;
  /** Called on every committed change. */
  readonly onChange?: (value: number) => void;
  /** Rendered after the value, e.g. a unit. */
  readonly suffix?: string;
}

export interface StepperHandle {
  readonly element: HTMLElement;
  /** The current clamped value. */
  getValue(): number;
  setValue(value: number): void;
}

export function createStepper(options: StepperOptions): StepperHandle {
  let value = options.clamp(options.initial);

  const input = el('input', {
    class: 'stepper__value mono',
    attrs: {
      type: 'text',
      // `text` plus a numeric inputmode keeps the numeric keypad while avoiding
      // the scroll-wheel and spinner behaviour of `type=number`, which fires
      // accidental changes when the page is scrolled with a finger on the field.
      inputmode: 'decimal',
      autocomplete: 'off',
      'aria-label': options.label,
      value: String(value),
    },
  });

  // Accepts raw field text as well as computed numbers; `clamp` coerces both.
  const commit = (next: unknown, writeBack: boolean): void => {
    value = options.clamp(next);
    if (writeBack) input.value = String(value);
    options.onChange?.(value);
  };

  // While typing, accept the raw text without rewriting the field — clamping
  // mid-keystroke would fight the user as they type a two-digit number.
  input.addEventListener('input', () => commit(input.value, false));
  input.addEventListener('blur', () => commit(input.value, true));

  const button = (symbol: string, delta: number, ariaLabel: string): HTMLButtonElement =>
    el('button', {
      class: 'stepper__button',
      text: symbol,
      attrs: { type: 'button', 'aria-label': ariaLabel },
      on: { click: () => commit(value + delta, true) },
    });

  const element = el('div', { class: 'stepper' }, [
    el('div', { class: 'stepper__label', text: options.label }),
    el('div', { class: 'stepper__row' }, [
      button('−', -options.step, `Decrease ${options.label.toLowerCase()}`),
      input,
      button('+', options.step, `Increase ${options.label.toLowerCase()}`),
    ]),
    options.suffix ? el('div', { class: 'stepper__suffix', text: options.suffix }) : null,
  ]);

  return {
    element,
    getValue: () => value,
    setValue: (next) => commit(next, true),
  };
}
