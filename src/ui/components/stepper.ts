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
      // Four characters covers `1000` and `22.5`; anything wider is clamped
      // away anyway. Keeps the field from claiming space it cannot use on a
      // phone, where two of these sit side by side.
      maxlength: '4',
      enterkeyhint: 'done',
      'aria-label': options.label,
      value: String(value),
    },
  });

  /*
   * Focusing selects the whole value, so the first digit typed replaces the
   * load instead of appending to it.
   *
   * Without this, changing 180 to 95 meant placing a caret by touch and
   * backspacing three times — on a small field, mid-set, with one hand. Typing
   * over a selection is the fast path, and a second tap in the focused field
   * still drops a caret for anyone who wants to edit a single digit.
   */
  const selectAll = (): void => {
    // Deferred: iOS Safari collapses the selection made during `focus` when it
    // places its own caret immediately afterwards.
    setTimeout(() => input.setSelectionRange(0, input.value.length), 0);
  };
  input.addEventListener('focus', selectAll);

  // Enter dismisses the keyboard rather than doing nothing, which is what the
  // `done` key on the numeric pad promises.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
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
