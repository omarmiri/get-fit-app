import type { Child } from '../dom';
import { PLAN_ORDER } from '@/data/plan';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderAccountCard } from '../components/accountCard';
import { renderPlanGenerator } from '../components/planGenerator';
import { renderPlanImport } from '../components/planImport';
import { renderPlanInputs } from '../components/planInputs';
import type { ViewContext } from './context';

/**
 * The first thing a new user sees.
 *
 * ## Why this exists
 *
 * The app used to open straight onto a seven-day rotation nobody had chosen,
 * with no indication of where it came from, while the two features that make
 * the app interesting — bring a plan from any LLM, or generate one — sat three
 * taps deep in a settings tab. Someone opening it for the first time would
 * reasonably conclude it was a fixed programme they had to follow.
 *
 * ## What it is not
 *
 * Not a sign-up wall. Two of the three routes need no account and no network,
 * the built-in week is still one tap away, and nothing here can be failed. The
 * question is only "how do you want to train", and every answer is allowed —
 * including "just give me something sensible".
 *
 * ## Why the built-in plan is offered last
 *
 * Not because it is worst. It is the fallback the whole app is built around
 * and there is nothing wrong with it. It is last because it is the option that
 * needs no explanation, and putting it first would make the other two look
 * like advanced settings — which is exactly the problem this screen fixes.
 */
export function renderWelcomeView(context: ViewContext): Child[] {
  return [
    div('spine', [
      eyebrow('Rack & File'),
      el('h1', { text: 'How do you want to train?' }),
      text(
        'spine__sub',
        'Pick one to get started. You can change it whenever you like, and nothing here is permanent.',
      ),
    ]),

    renderBuiltInCard(context),
    renderPlanInputs(() => {
      /* No re-render: redrawing on each keystroke would lose the caret. */
    }),
    renderPlanImport(context),
    renderPlanGenerator(context),
    renderAccountCard(context),
    renderFooter(),
  ];
}

/**
 * The one-tap answer.
 *
 * Deliberately concrete about what it contains rather than selling it — a
 * seven-day rotation is easy to describe, and someone can decide from the
 * description whether it suits them.
 */
function renderBuiltInCard(context: ViewContext): HTMLElement {
  const days = PLAN_ORDER.map((key) => context.plan[key].label);

  return card([
    eyebrow('Start with the built-in week'),
    text(
      'prose',
      'A balanced seven-day rotation: two full-body strength sessions spread apart, cardio between them, and a recovery day. Sensible for most people and ready right now.',
    ),

    el(
      'ul',
      { class: 'welcome__days' },
      days.map((label) => el('li', { class: 'welcome__day', text: label })),
    ),

    el('button', {
      class: 'button button--primary',
      text: 'Use this and start training',
      attrs: { type: 'button' },
      on: {
        click: () => {
          context.store.setWelcomed(true);
          toast('Ready — this is your week');
          context.render();
        },
      },
    }),
  ]);
}

function renderFooter(): HTMLElement {
  return card([
    eyebrow('Before you push'),
    text(
      'prose',
      'This is a training log, not medical advice. Everything stays on your device unless you sign in. Stop the session if you get chest pain, dizziness, or shortness of breath out of proportion to the effort, and talk to your doctor before ramping up.',
    ),
  ]);
}
