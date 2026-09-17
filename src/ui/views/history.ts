import type { Child } from '../dom';
import type { MovementSummary, WeekGroup } from '@/state/selectors';
import type { Session } from '@/types';
import { GOALS, getPlanDay } from '@/data/plan';
import { PLATE } from '@/data/plates';
import { formatDuration, formatShortDate, toIsoDate } from '@/domain/dates';
import { formatVolume } from '@/domain/units';
import {
  currentStreak,
  describeProgress,
  isStalled,
  minutesByWeek,
  movementSummaries,
  sessionsByWeek,
  trendPoints,
} from '@/state/selectors';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderMinutesChart, renderTrendChart } from '../components/charts';
import { renderGoalsCard } from '../components/goalsCard';
import type { ViewContext } from './context';

/**
 * The History tab.
 *
 * It used to answer "am I getting stronger" one movement at a time, behind a
 * native select. Answering it for twelve movements meant twelve taps, so
 * nobody did it — and the honest summary of the tab was "here is one line
 * about leg press, then thirty-five rows of deleted-by-accident risk".
 *
 * So it leads with the answer: two sentences, then every movement at once,
 * sorted by how far it has moved, with the number and the direction in text
 * beside it. The chart stays, below, and the picker becomes a tap on a row.
 * The log collapses by week, with the week's totals on the header.
 *
 * The weekly goals card lives here too. It was on the Today tab, where nobody
 * adjusts a set because they are 95 aerobic minutes short.
 */
export function renderHistoryView(context: ViewContext): Child[] {
  const { state } = context;
  const count = state.sessions.length;
  const weeks = sessionsByWeek(state, state.prefs.unit);

  const header = div('spine', [
    eyebrow(
      count === 1
        ? '1 session · 1 week'
        : `${count} sessions · ${weeks.length} week${weeks.length === 1 ? '' : 's'}`,
    ),
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
    renderAnswer(context),
    renderMovementList(context),
    renderTrendChartSection(context),
    renderAerobic(context),
    renderGoalsCard(context.state, context.plan),
    renderLog(context, weeks),
  ];
}

/* ----------------------------------------------------------- the answer */

/**
 * Two sentences, which are the whole tab for most visits.
 *
 * A streak belongs here rather than on Today. It is history, not an
 * instruction — and it was pointed at the screen you read mid-set.
 */
function renderAnswer(context: ViewContext): HTMLElement | null {
  const summaries = movementSummaries(context.state, context.state.prefs.unit);
  const lines = describeProgress(summaries);
  if (lines.length === 0) return null;

  const streak = currentStreak(context.state);

  return card([
    eyebrow('Getting stronger'),
    ...lines.map((line) => text('answer__line', line)),
    streak > 1 ? text('answer__streak', `${streak} days in a row.`) : null,
  ]);
}

/* -------------------------------------------------------- movement list */

function renderMovementList(context: ViewContext): HTMLElement | null {
  const summaries = movementSummaries(context.state, context.state.prefs.unit);
  if (summaries.length === 0) return null;

  const selected = selectedMovementId(context, summaries);

  return card(
    [
      // Said once, at the top, rather than on every row.
      text('club__hint', 'Estimated from your logged sets. Tap a movement for its full chart.'),
      ...summaries.map((summary) => renderMovementRow(context, summary, summary.id === selected)),
    ],
    'movements',
  );
}

function renderMovementRow(context: ViewContext, summary: MovementSummary, selected: boolean): HTMLElement {
  return el(
    'button',
    {
      class: selected ? 'moverow is-selected' : 'moverow',
      attrs: {
        type: 'button',
        'aria-pressed': selected,
        'aria-label': `${summary.name}, ${describeMovement(summary, context)}. Show chart`,
      },
      on: {
        click: () => {
          context.store.setTrendExercise(summary.id);
          context.render();
        },
      },
    },
    [
      div('moverow__text', [
        text('moverow__name', summary.name),
        text('moverow__sub', describeMovement(summary, context)),
      ]),
      text(
        `moverow__delta is-${direction(summary)}`,
        summary.change === null ? '—' : formatDelta(summary.change),
      ),
    ],
  );
}

function describeMovement(summary: MovementSummary, context: ViewContext): string {
  const unit = context.state.prefs.unit;
  const load = `${Math.round(summary.latest)} ${unit}`;

  if (isStalled(summary)) return `${load} · ${summary.flatSessions} sessions flat`;
  if ((summary.change ?? 0) < 0) return `${load} · deload suggested`;
  return `${load} est. 1RM`;
}

function direction(summary: MovementSummary): 'up' | 'flat' | 'down' {
  if (isStalled(summary)) return 'flat';
  return (summary.change ?? 0) < 0 ? 'down' : 'up';
}

function formatDelta(change: number): string {
  const rounded = Math.round(change);
  if (rounded === 0) return 'flat';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

function selectedMovementId(context: ViewContext, summaries: readonly MovementSummary[]): string | undefined {
  const stored = context.state.prefs.trendExerciseId;
  return summaries.some((entry) => entry.id === stored) ? stored : summaries[0]?.id;
}

function renderTrendChartSection(context: ViewContext): HTMLElement | null {
  const summaries = movementSummaries(context.state, context.state.prefs.unit);
  const selected = selectedMovementId(context, summaries);
  if (!selected) return null;

  const summary = summaries.find((entry) => entry.id === selected);

  return card([
    eyebrow(summary?.name ?? 'Strength trend'),
    renderTrendChart(
      trendPoints(context.state, selected, context.state.prefs.unit),
      context.state.prefs.unit,
    ),
  ]);
}

/* --------------------------------------------------------------- aerobic */

function renderAerobic(context: ViewContext): HTMLElement {
  const buckets = minutesByWeek(context.state, 8, new Date(), context.plan);
  const best = buckets.reduce(
    (peak, bucket) => (bucket.minutes > (peak?.minutes ?? 0) ? bucket : peak),
    buckets[0],
  );

  return card([
    eyebrow('Aerobic minutes'),
    renderMinutesChart(buckets, GOALS.minutes),
    best && best.minutes > 0
      ? text(
          'chart-block__caption',
          `Best week: ${best.minutes} min, ${formatShortDate(toIsoDate(best.weekStart))}.`,
        )
      : null,
  ]);
}

/* ------------------------------------------------------------------- log */

/**
 * The log, one week per row.
 *
 * Each week carries the totals that trend — sessions, minutes, volume — and
 * opens to the sessions inside it. Volume is gone from the individual rows: it
 * was the least useful number on them and the widest, and the space says what
 * the session actually was instead.
 */
function renderLog(context: ViewContext, weeks: readonly WeekGroup[]): HTMLElement {
  return card(
    weeks.map((week, index) => renderWeek(context, week, index === 0)),
    'card--flush',
  );
}

function renderWeek(context: ViewContext, week: WeekGroup, open: boolean): HTMLElement {
  const unit = context.state.prefs.unit;
  const from = toIsoDate(week.weekStart);
  const to = toIsoDate(new Date(week.weekStart.getTime() + 6 * 86_400_000));

  const totals = [
    `${week.sessions.length} session${week.sessions.length === 1 ? '' : 's'}`,
    week.minutes > 0 ? `${week.minutes} min` : null,
    week.volume > 0 ? formatVolume(week.volume, unit) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return el('details', { class: 'weekgroup', attrs: open ? { open: true } : {} }, [
    el('summary', { class: 'weekgroup__head' }, [
      div('', [
        text('weekgroup__range', `${formatShortDate(from)} – ${formatShortDate(to)}`),
        text('weekgroup__totals', totals),
      ]),
      el('span', { class: 'cues__chevron', attrs: { 'aria-hidden': 'true' }, text: '▾' }),
    ]),
    ...week.sessions.map((session) => renderSessionRow(context, session)),
  ]);
}

/**
 * One session, and the way to remove it.
 *
 * Delete used to be a 32px link sitting in the open beside nothing, on every
 * one of thirty-five rows. It is inside the row now: tapping opens the
 * session, and the control is in there at full size — reachable by keyboard,
 * unlike a swipe, and not something you hit while scrolling past.
 */
function renderSessionRow(context: ViewContext, session: Session): HTMLElement {
  const day = context.plan[session.dayKey] ?? getPlanDay(session.dayKey);
  // The label recorded at the time wins. Looking it up would rename past
  // sessions whenever the plan changes.
  const label = session.planLabel ?? day?.label ?? session.dayKey;
  const color = day?.color ?? PLATE.white;

  return el('details', { class: 'logitem' }, [
    el('summary', { class: 'logrow logitem__head' }, [
      div('logrow__main', [
        el('div', {
          class: 'logrow__bar',
          style: { background: color },
          attrs: { 'aria-hidden': 'true' },
        }),
        div('', [text('logrow__title', label), text('logrow__sub', describe(session))]),
      ]),
      text('mono logrow__date', formatShortDate(session.date)),
    ]),
    el('button', {
      class: 'button button--ghost button--danger',
      text: 'Delete this session',
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
  ]);
}

/** What the session was. Volume lives on the week header, where it trends. */
function describe(session: Session): string {
  const parts: string[] = [];

  if (session.sets.length > 0) {
    parts.push(session.sets.length === 1 ? '1 set' : `${session.sets.length} sets`);
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
