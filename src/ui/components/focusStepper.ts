import { el } from '../dom';

/**
 * A weight or reps control for the mid-workout screen.
 *
 * The ordinary stepper is a 40 × 44 button either side of a text field. On a
 * 6-inch phone the centre of that plus button sits about 300px from the base of
 * the screen — the middle of the hand, not where a thumb rests — and the number
 * between the buttons is a field you can drop a caret into by accident while
 * reaching for it.
 *
 * So this one drops the field. The value moves out to the readout above, and
 * what is left is two 68px buttons, each half the column wide, in the bottom
 * third of the screen. Typing is still reachable for the rare 190 → 95 case:
 * hold either button, or tap the readout, and a numeric field takes over the
 * row until it is dismissed.
 */

/** How long a press has to last before it counts as "I want to type". */
const HOLD_MS = 450;

export interface FocusStepperOptions {
  readonly label: string;
  /** The line under the label: step size, or the target rep range. */
  readonly hint: string;
  readonly initial: number;
  readonly step: number;
  readonly clamp: (value: unknown) => number;
  readonly onChange: (value: number) => void;
}

export interface FocusStepperHandle {
  readonly element: HTMLElement;
  getValue(): number;
  setValue(value: number): void;
  /** Swap the buttons for a numeric field and focus it. */
  openKeypad(): void;
}

export function createFocusStepper(options: FocusStepperOptions): FocusStepperHandle {
  let value = options.clamp(options.initial);

  const commit = (next: unknown): void => {
    value = options.clamp(next);
    options.onChange(value);
  };

  const input = el('input', {
    class: 'fstep__input mono',
    attrs: {
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      maxlength: '4',
      enterkeyhint: 'done',
      'aria-label': options.label,
    },
  });

  const row = el('div', { class: 'fstep__row' });

  const closeKeypad = (): void => {
    commit(input.value);
    row.dataset.editing = 'false';
  };

  input.addEventListener('input', () => commit(input.value));
  input.addEventListener('blur', closeKeypad);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') input.blur();
  });

  const openKeypad = (): void => {
    input.value = String(value);
    row.dataset.editing = 'true';
    // Deferred so the field is visible before it is asked to take focus;
    // iOS Safari refuses to raise the keyboard for a hidden element.
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(0, input.value.length);
    }, 0);
  };

  /*
   * A press that becomes a hold opens the keypad and cancels the step, so the
   * value does not move by 5 lb on the way to typing 95. `pointercancel` covers
   * the scroll case, where the browser takes the gesture away mid-press.
   */
  const button = (symbol: string, delta: number, ariaLabel: string): HTMLButtonElement => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held = false;

    const cancel = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const node = el('button', {
      class: 'fstep__btn',
      text: symbol,
      attrs: { type: 'button', 'aria-label': ariaLabel },
      on: {
        pointerdown: () => {
          held = false;
          cancel();
          timer = setTimeout(() => {
            held = true;
            openKeypad();
          }, HOLD_MS);
        },
        pointerup: cancel,
        pointerleave: cancel,
        pointercancel: cancel,
        click: () => {
          cancel();
          if (held) {
            held = false;
            return;
          }
          commit(value + delta);
        },
      },
    });

    return node;
  };

  const lower = options.label.toLowerCase();
  row.append(
    button('−', -options.step, `Decrease ${lower}`),
    button('+', options.step, `Increase ${lower}`),
    input,
  );
  row.dataset.editing = 'false';

  const element = el('div', { class: 'fstep' }, [
    el('div', { class: 'fstep__label', text: options.label }),
    el('div', { class: 'fstep__hint', text: options.hint }),
    row,
  ]);

  return {
    element,
    getValue: () => value,
    setValue: (next) => commit(next),
    openKeypad,
  };
}
