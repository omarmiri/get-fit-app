import { activePlan } from '@/data/catalogue';
import { describePlanName } from '@/data/activePlan';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';

/**
 * The plans the user has kept, and which one is running.
 *
 * Adopting a plan used to overwrite the previous one, so trying a week your
 * LLM wrote meant destroying the block you had been running. Training is
 * seasonal — a winter strength block, a travel week, something to work around
 * a bad shoulder — and all of those are worth keeping.
 *
 * The built-in rotation is always the first row and can never be deleted. It
 * is the floor: whatever else is in the list, there is a known-good week one
 * tap away.
 */
export function renderPlanLibrary(context: ViewContext): HTMLElement {
  const { plans } = context.state;
  const current = activePlan(context.state);

  return card([
    eyebrow('Your workout plans'),
    text('prose', 'Tap a workout plan to switch to it. Your history stays the same.'),

    el('ul', { class: 'planlist' }, [
      renderRow(context, null, current === null),
      ...plans.map((plan) => renderRow(context, plan, plan.id === current?.id)),
    ]),
  ]);
}

/** One plan in the list. `plan` of `null` is the built-in rotation. */
function renderRow(
  context: ViewContext,
  plan: (typeof context.state.plans)[number] | null,
  isActive: boolean,
): HTMLElement {
  const name = plan ? describePlanName(plan) : 'Starter workout plan';
  // A plan with an empty summary shows no subtitle rather than a stray blank
  // line, so this is a deliberate falsy check and not a nullish one.
  const sub = plan ? (plan.summary ? plan.summary : '') : 'Seven days that work in any gym. Always here.';

  return el('li', { class: isActive ? 'planlist__item is-active' : 'planlist__item' }, [
    el(
      'button',
      {
        class: 'planlist__pick',
        attrs: {
          type: 'button',
          'aria-pressed': isActive,
          'aria-label': isActive ? `${name}, active` : `Switch to ${name}`,
        },
        on: {
          click: () => {
            if (isActive) return;
            context.store.selectPlan(plan?.id ?? null);
            // The week strip and today's accent both key off the plan, so a
            // switch has to redraw everything rather than just this card.
            context.render();
            toast(`Switched to ${name}`);
          },
        },
      },
      [
        div('planlist__main', [
          div('planlist__title', [
            el('span', { class: 'planlist__name', text: name }),
            isActive ? el('span', { class: 'swap__tag', text: 'Active' }) : null,
          ]),
          sub ? text('planlist__sub', sub) : null,
        ]),
      ],
    ),

    plan
      ? div('planlist__actions', [
          el('button', {
            class: 'planlist__action',
            text: 'Rename',
            attrs: { type: 'button', 'aria-label': `Rename ${name}` },
            on: {
              click: () => {
                const next = prompt('Name this workout plan', plan.name ?? '');
                // `null` is cancel; an empty string is a deliberate clear, and
                // restores the model-and-date label.
                if (next === null) return;
                context.store.renamePlan(plan.id, next);
                context.render();
              },
            },
          }),
          el('button', {
            class: 'planlist__action planlist__action--danger',
            text: 'Delete',
            attrs: { type: 'button', 'aria-label': `Delete ${name}` },
            on: {
              click: () => {
                if (!confirm(`Delete "${name}"? Your logged sessions are not affected.`)) return;
                context.store.deletePlan(plan.id);
                toast(isActive ? 'Deleted — back to the starter workout plan' : 'Workout plan deleted');
                context.render();
              },
            },
          }),
        ])
      : null,
  ]);
}
