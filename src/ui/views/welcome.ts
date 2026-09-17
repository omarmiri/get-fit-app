import type { Child } from '../dom';
import { div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from './context';

/**
 * The first thing a new user sees.
 *
 * ## Why this is two buttons
 *
 * It used to be four screens of scroll. Venue, eleven equipment chips,
 * outdoors, days a week, minutes per session, what you enjoy, then the prompt
 * paragraph, then the built-in week, then health context and things to work
 * around, then three chatbot launchers and an import explainer, then a safety
 * note — and if you accepted the built-in week, a further screen asking age,
 * bodyweight and experience before the session appeared. Seven taps to a first
 * logged set.
 *
 * Every one of those questions is defensible and the set is still wrong,
 * because none of them are needed to log a leg press. The whole survey exists
 * to make a *generated* plan good, and generating a plan is the second thing
 * anyone does, not the first.
 *
 * ## Where the questions went
 *
 * They are re-timed, not lost.
 *
 * - Venue, equipment, days, length, likes, health context and the prompt
 *   paragraph move to the front of "Write me a new week", where someone has
 *   chosen to spend a minute on them — and where the app can pre-fill half of
 *   them from what has actually been logged.
 * - Bodyweight and experience become one question at the first machine:
 *   "is 95 lb about right?". That is the only place it can be answered
 *   honestly. Age goes entirely; it moves the estimate less than the rounding
 *   already does.
 * - Equipment is inferred. The swap sheet asks "is this at your gym?" at the
 *   exact moment a machine is missing, and that answer is worth more than a
 *   checkbox ticked in a kitchen.
 *
 * ## Why the safety note stays
 *
 * It is short, it is honest and it costs nothing. It is a line under the two
 * buttons rather than a card of its own.
 */
export function renderWelcomeView(context: ViewContext): Child[] {
  return [
    div('spine', [
      eyebrow('Rack & File'),
      el('h1', { text: 'Your week, on this phone' }),
      text(
        'spine__sub',
        'Nothing leaves the device. No account. Start with the built-in rotation and change it whenever you like.',
      ),
    ]),

    div('doors', [
      renderDoor({
        label: 'Start training now',
        hint: 'Seven-day rotation, ready',
        primary: true,
        onChoose: () => {
          context.store.setWelcomed(true);
          toast('Ready — this is your week');
          context.render();
        },
      }),
      renderDoor({
        label: 'Bring a plan from an LLM',
        hint: 'Six questions, about a minute',
        primary: false,
        onChoose: () => {
          // Still the built-in week underneath, so there is something to train
          // against if the plan-writing flow is abandoned half way.
          context.store.setWelcomed(true);
          context.ui.tab = 'plan';
          context.render();
        },
      }),
    ]),

    text(
      'welcome__safety',
      'A training log, not medical advice. Stop if you get chest pain or dizziness out of proportion to the effort.',
    ),
  ];
}

/**
 * One of the two answers.
 *
 * Both are complete and neither is an advanced setting — which is the whole
 * point. The built-in week used to be the eighth thing on the screen, below
 * the survey that exists to replace it.
 */
function renderDoor(options: {
  label: string;
  hint: string;
  primary: boolean;
  onChoose: () => void;
}): HTMLElement {
  return el(
    'button',
    {
      class: options.primary ? 'door door--primary' : 'door',
      attrs: { type: 'button' },
      on: { click: options.onChoose },
    },
    [text('door__label', options.label), text('door__hint', options.hint)],
  );
}
