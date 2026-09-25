import { describePlanName } from '@/data/activePlan';
import { activePlan } from '@/data/catalogue';
import { card, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';

/**
 * The once-a-week question: which workout plan this week?
 *
 * Training runs in blocks, and the natural moment to change block is the start
 * of a week — but a plan list tucked in the Plan tab is only ever found by
 * someone already looking for it. So the first time the app is opened in a new
 * week, Today asks. Every answer is one tap, keeping the current plan is the
 * default, and nothing blocks the day: the card sits above the session rather
 * than in front of it, and is not shown mid-workout.
 */
export function renderWeekCheckIn(context: ViewContext): HTMLElement | null {
  if (!context.store.needsWeekChoice() || context.state.active) return null;

  const current = activePlan(context.state);
  const currentName = current ? describePlanName(current) : 'the starter workout plan';

  const choose = (planId: string | null | undefined, message: string): void => {
    if (planId !== undefined) context.store.selectPlan(planId);
    context.store.confirmWeek();
    toast(message);
    context.render();
  };

  // Every other plan, the starter included when it is not the one running.
  const others = [
    ...(current ? [{ id: null, name: 'Starter workout plan' }] : []),
    ...context.state.plans
      .filter((plan) => plan.id !== current?.id)
      .map((plan) => ({ id: plan.id, name: describePlanName(plan) })),
  ];

  return card([
    eyebrow('New week'),
    text('prose', 'Which workout plan do you want to use this week?'),

    el('button', {
      class: 'button button--primary',
      text: `Keep ${currentName}`,
      attrs: { type: 'button' },
      on: { click: () => choose(undefined, `Keeping ${currentName} this week`) },
    }),

    ...others.map((other) =>
      el('button', {
        class: 'button button--ghost',
        text: `Switch to ${other.name}`,
        attrs: { type: 'button' },
        on: { click: () => choose(other.id, `Switched to ${other.name}`) },
      }),
    ),

    el('button', {
      class: 'button button--ghost',
      text: 'New workout plan with ChatGPT',
      attrs: { type: 'button' },
      on: {
        click: () => {
          // Answered: until the new plan arrives, the current one carries on.
          context.store.confirmWeek();
          context.ui.tab = 'plan';
          context.ui.planRoute = 'write';
          context.ui.writeStep = 0;
          context.render();
        },
      },
    }),
  ]);
}
