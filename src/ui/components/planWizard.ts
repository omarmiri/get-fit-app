import type { Child } from '../dom';
import type { GymStep } from './gymSetup';
import { div, el, text } from '../dom';
import { renderGymStep, renderPromptPreview } from './gymSetup';
import { renderPlanInputs } from './planInputs';
import { renderPlanImport } from './planImport';
import type { ViewContext } from '../views/context';

/**
 * Writing a week: the one thing in the Plan tab that is actually a task.
 *
 * A wizard is good for something done rarely and badly, and bad for something
 * done often. Writing a plan is the first kind — it has a sequence, a finish
 * line and a real failure mode. Marking a machine as missing, switching units
 * and exporting a backup are all the second kind, and they stay as lists of
 * switches elsewhere in the tab. Splitting by how often you come here fixes
 * more than splitting by topic would.
 *
 * Every step is skippable and the progress bar is honest. No step carries two
 * unrelated questions.
 */

interface Step {
  readonly title: string;
  /** The label on the button that leaves this step. */
  readonly next: string;
  readonly render: (context: ViewContext) => Child[];
}

const STEPS: readonly Step[] = [
  {
    title: 'Where you train',
    next: 'Next — what is there',
    render: (context) => gym(context, 'venue'),
  },
  {
    title: 'What is at your gym',
    next: 'Next — how you train',
    render: (context) => gym(context, 'equipment'),
  },
  {
    title: 'How you train',
    next: 'Next — send it',
    render: (context) => [
      ...gym(context, 'habits'),
      renderPlanInputs(() => {
        /* No re-render: redrawing on each keystroke would lose the caret. */
      }),
    ],
  },
  {
    title: 'Send it',
    next: '',
    render: (context) => [renderPromptPreview(context), renderPlanImport(context)],
  },
];

export const WIZARD_STEPS = STEPS.length;

function gym(context: ViewContext, step: GymStep): Child[] {
  return renderGymStep(context, step);
}

export function renderPlanWizard(context: ViewContext): Child[] {
  const index = Math.min(Math.max(context.ui.writeStep, 0), STEPS.length - 1);
  context.ui.writeStep = index;

  const step = STEPS[index];
  if (!step) return [];

  const last = index === STEPS.length - 1;

  const go = (to: number): void => {
    context.ui.writeStep = to;
    context.render();
  };

  return [
    div('wizard__head', [
      text('eyebrow', `Step ${index + 1} of ${STEPS.length}`),
      el('button', {
        class: 'wizard__skip',
        text: last ? 'Done' : 'Skip',
        attrs: { type: 'button' },
        on: { click: () => (last ? backToMenu(context) : go(index + 1)) },
      }),
    ]),

    // An honest bar: one filled segment per step actually left behind.
    el(
      'div',
      {
        class: 'wizard__bar',
        attrs: {
          role: 'progressbar',
          'aria-valuenow': index + 1,
          'aria-valuemin': 1,
          'aria-valuemax': STEPS.length,
          'aria-label': `Step ${index + 1} of ${STEPS.length}`,
        },
        style: { '--wizard-count': String(STEPS.length) },
      },
      STEPS.map((_, position) => el('i', { class: position <= index ? 'is-done' : '' })),
    ),

    el('h2', { class: 'wizard__title', text: step.title }),

    ...step.render(context),

    last
      ? el('button', {
          class: 'button button--ghost',
          text: 'Back to the plan menu',
          attrs: { type: 'button' },
          on: { click: () => backToMenu(context) },
        })
      : el('button', {
          class: 'button button--primary',
          text: step.next,
          attrs: { type: 'button' },
          on: { click: () => go(index + 1) },
        }),

    index > 0
      ? el('button', {
          class: 'button button--ghost',
          text: 'Back',
          attrs: { type: 'button' },
          on: { click: () => go(index - 1) },
        })
      : null,
  ];
}

function backToMenu(context: ViewContext): void {
  context.ui.planRoute = 'menu';
  context.ui.writeStep = 0;
  context.render();
}
