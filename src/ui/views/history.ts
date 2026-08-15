import type { Child } from '../dom';
import type { Session } from '@/types';
import { GOALS, getPlanDay } from '@/data/plan';
import { PLATE } from '@/data/plates';
import { formatDuration, formatShortDate } from '@/domain/dates';
import { sessionVolume } from '@/domain/metrics';
import { formatVolume } from '@/domain/units';
import { minutesByWeek, trendPoints, trendableExercises } from '@/state/selectors';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderMinutesChart, renderTrendChart } from '../components/charts';
import type { ViewContext } from './context';

/** The History tab: weekly aerobic totals, a strength trend, and the session log. */
export function renderHistoryView(context: ViewContext): Child[] {
  const { state } = context;
  const count = state.sessions.length;

  const header = div('spine', [
    eyebrow(count === 1 ? '1 session logged' : `${count} sessions logged`),
    el('h1', { text: 'History' }),
  ]);

  if (count === 0) {
    return [
      header,
      renderEmpty(
        'Nothing logged yet.',
        'Finish a session on the Today tab and it will show up here, along with your strength trends.',
      ),
    ];
  }

  return [
    header,
    card([
      eyebrow('Aerobic minutes by week'),
      renderMinutesChart(minutesByWeek(state, 8, new Date(), context.plan), GOALS.minutes),
    ]),
    renderTrendSection(context),
    renderSessionLog(context),
  ];
}

/* ------------------------------------------------------------------ trend */

function renderTrendSection(context: ViewContext): HTMLElement | null {
  const { state } = context;
  const options = trendableExercises(state);
  if (options.length === 0) return null;

  const stored = state.prefs.trendExerciseId;
  const selectedId = options.some((e) => e.id === stored) ? stored : options[0]?.id;
  if (!selectedId) return null;

  const holder = div('trend__chart', [
    renderTrendChart(trendPoints(state, selectedId, state.prefs.unit), state.prefs.unit),
  ]);

  const picker = el(
    'select',
    {
      class: 'picker',
      attrs: { 'aria-label': 'Exercise to chart' },
      on: {
        change: (event) => {
          const value = (event.target as HTMLSelectElement).value;
          context.store.setTrendExercise(value);
          context.render();
        },
      },
    },
    options.map((exercise) =>
      el('option', {
        text: exercise.name,
        attrs: { value: exercise.id, selected: exercise.id === selectedId },
      }),
    ),
  );

  return card([eyebrow('Strength trend'), picker, holder]);
}

/* -------------------------------------------------------------- session log */

function renderSessionLog(context: ViewContext): HTMLElement {
  // Newest first, without mutating the store's ordering.
  const sessions = [...context.state.sessions].reverse();

  return card(
    sessions.map((session) => renderSessionRow(context, session)),
    'card--flush',
  );
}

function renderSessionRow(context: ViewContext, session: Session): HTMLElement {
  const day = context.plan[session.dayKey] ?? getPlanDay(session.dayKey);
  // The label recorded at the time wins. Looking it up would rename past
  // sessions whenever the plan changes.
  const label = session.planLabel ?? day?.label ?? session.dayKey;
  const color = day?.color ?? PLATE.white;

  return div('logrow', [
    div('logrow__main', [
      el('div', { class: 'logrow__bar', style: { background: color }, attrs: { 'aria-hidden': 'true' } }),
      div('', [text('logrow__title', label), text('logrow__sub', describe(session, context))]),
    ]),
    div('logrow__side', [
      text('mono logrow__date', formatShortDate(session.date)),
      el('button', {
        class: 'logrow__delete',
        text: 'Delete',
        attrs: {
          type: 'button',
          'aria-label': `Delete ${label} session on ${formatShortDate(session.date)}`,
        },
        on: {
          click: () => {
            if (!confirm(`Delete this ${label} session from ${formatShortDate(session.date)}?`)) return;
            context.store.deleteSession(session.id);
            toast('Session deleted');
            context.render();
          },
        },
      }),
    ]),
  ]);
}

function describe(session: Session, context: ViewContext): string {
  const unit = context.state.prefs.unit;
  const parts: string[] = [];

  if (session.sets.length > 0) {
    parts.push(session.sets.length === 1 ? '1 set' : `${session.sets.length} sets`);
    // Passing state, not just the plan: a session may contain a movement whose
    // plan has since been replaced, and its volume still counts.
    const volume = sessionVolume(session.sets, unit, context.state);
    if (volume > 0) parts.push(formatVolume(volume, unit));
  }
  if (session.minutes) parts.push(`${session.minutes} min`);
  if (session.modality) parts.push(session.modality);
  if (session.effort) parts.push(session.effort);
  // Suffixed, because `45 min` of cardio and a 45-minute session are different
  // claims and the row has no room to spell out which is which.
  if (session.durationMinutes) parts.push(`${formatDuration(session.durationMinutes)} total`);

  return parts.join(' · ');
}

function renderEmpty(title: string, body: string): HTMLElement {
  return card([div('empty', [text('empty__title', title), text('empty__body', body)])]);
}
