import {
  getConditionsText,
  getNotes,
  setConditionsText,
  setNotes,
} from '@/state/ephemeral';
import { card, div, el, eyebrow, text } from '../dom';

/**
 * What a plan should be written around, this time.
 *
 * Shared by both routes — the prompt you copy to your own LLM and the plan
 * generated in-app — so it is one card rather than the same two fields in
 * both.
 *
 * ## Nothing here is saved
 *
 * These fields used to be a persisted preference, so health context would not
 * have to be retyped. That was a real convenience and the wrong trade: it
 * turned a sentence typed once into a medical detail sitting in browser
 * storage indefinitely, and under accounts it would have become one sitting in
 * a database.
 *
 * It is now used for one generation and forgotten when the tab closes. The
 * card says so out loud, because an input that silently persists and an input
 * that silently does not look identical, and the user is entitled to know
 * which one they are typing into.
 */
export function renderPlanInputs(onChange: () => void): HTMLElement {
  return card([
    eyebrow('About this week'),
    text(
      'prose',
      'Used to write the plan and then forgotten — none of this is saved to your device or sent anywhere on its own.',
    ),

    div('gen__group', [
      eyebrow('Health context'),
      renderField(
        getConditionsText(),
        'e.g. high cholesterol, high glucose',
        'Health context for this plan',
        (value) => {
          setConditionsText(value);
          onChange();
        },
      ),
      text(
        'club__hint',
        'Shapes intensity and impact. Included in the prompt you copy, and sent once if you generate a plan here.',
      ),
    ]),

    div('gen__group', [
      eyebrow('Anything to work around'),
      renderField(
        getNotes(),
        'e.g. sore left shoulder, travelling Thursday',
        'Anything to work around this week',
        (value) => {
          setNotes(value);
          onChange();
        },
      ),
    ]),
  ]);
}

function renderField(
  initial: string,
  placeholder: string,
  label: string,
  onInput: (value: string) => void,
): HTMLElement {
  return el('input', {
    class: 'gen__input',
    attrs: { type: 'text', autocomplete: 'off', placeholder, value: initial, 'aria-label': label },
    // `input` rather than `change`: the value has to be current when the copy
    // button is tapped, and on a phone that tap can land before the field has
    // blurred.
    on: { input: (event) => onInput((event.target as HTMLInputElement).value) },
  });
}
