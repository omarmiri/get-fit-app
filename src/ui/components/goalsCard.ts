import type { AppState } from '@/types';
import { type ActivePlan, weekStats } from '@/state/selectors';
import { card, div, el, eyebrow } from '../dom';

/**
 * Weekly progress against the aerobic-minutes and strength-session targets.
 *
 * The streak line that used to be here has moved to History. A streak is
 * history, not an instruction, and this card was pointed at the screen you
 * read between two machines.
 */
export function renderGoalsCard(state: AppState, plan: ActivePlan, now: Date = new Date()): HTMLElement {
  const stats = weekStats(state, now, plan);

  return card([
    eyebrow('This week'),
    renderGoal('Aerobic minutes', stats.aerobicMinutes, stats.minutesGoal),
    renderGoal('Strength sessions', stats.strengthSessions, stats.strengthGoal),
  ]);
}

function renderGoal(label: string, value: number, target: number): HTMLElement {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0;

  return div('goal', [
    div('goal__top', [
      el('span', { text: label }),
      el('span', { class: 'mono', text: `${value} / ${target}` }),
    ]),
    el(
      'div',
      {
        class: 'goal__track',
        attrs: {
          role: 'progressbar',
          'aria-label': label,
          'aria-valuenow': value,
          'aria-valuemin': 0,
          'aria-valuemax': target,
          'aria-valuetext': `${value} of ${target}`,
        },
      },
      [
        el('div', {
          class: percent >= 100 ? 'goal__fill is-complete' : 'goal__fill',
          style: { width: `${percent}%` },
        }),
      ],
    ),
  ]);
}
