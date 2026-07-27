import type { Child } from '../dom';
import type { DayKey, PlanDay, Session } from '@/types';
import { DAY_NAMES, PLAN } from '@/data/plan';
import { stationName } from '@/data/equipment';
import { defaultStationId } from '@/domain/substitutions';
import { formatShortDate, formatWithWeekday, todayDayKey, todayIso } from '@/domain/dates';
import { sessionVolume } from '@/domain/metrics';
import { formatVolume } from '@/domain/units';
import { lastPerformance, todaysSession } from '@/state/selectors';
import { AppStore } from '@/state/store';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderDurationCard } from '../components/durationCard';
import { renderExerciseCard } from '../components/exerciseCard';
import { renderGoalsCard } from '../components/goalsCard';
import type { ViewContext } from './context';

/** The Today tab: the session for the selected plan day, and the controls to log it. */
export function renderTodayView(context: ViewContext): Child[] {
  const dayKey = context.ui.viewDay ?? todayDayKey();
  const day = PLAN[dayKey];

  return [
    renderHeader(day),
    renderStaleBanner(context),
    renderDateNotice(dayKey),
    ...renderBody(context, dayKey, day),
    card([eyebrow('How to run it'), text('prose', day.note)]),
    renderGoalsCard(context.state),
  ];
}

function renderHeader(day: PlanDay): HTMLElement {
  return div('spine', [
    eyebrow(`${DAY_NAMES[day.key]} · ${day.load} plate`),
    el('h1', { text: day.label }),
    text('spine__sub', day.sub),
  ]);
}

/**
 * Tell the user when they are looking at a day other than today.
 *
 * Logging always records the real calendar date — that is what makes the
 * history and the weekly totals meaningful — so browsing Friday's plan on a
 * Tuesday and logging it produces a Tuesday-dated session that followed the
 * Friday plan. Saying so up front avoids a confusing surprise in History.
 */
function renderDateNotice(dayKey: DayKey): HTMLElement | null {
  if (dayKey === todayDayKey()) return null;

  return div('notice', [
    text(
      'notice__body',
      `Viewing the ${PLAN[dayKey].label} plan. Anything you log is recorded against today, ${formatWithWeekday(todayIso())}.`,
    ),
  ]);
}

/**
 * Offer to save or discard a session left open on an earlier day.
 *
 * v0.1 dropped these silently on the next launch, so a session logged but never
 * finished vanished overnight.
 */
function renderStaleBanner(context: ViewContext): HTMLElement | null {
  const stale = context.store.staleActive();
  if (!stale) return null;

  const summary = describeSession(stale, context);

  return div('notice notice--warn', [
    eyebrow('Unfinished session'),
    text(
      'notice__body',
      `You left a ${PLAN[stale.dayKey].label} session open on ${formatShortDate(stale.date)} — ${summary}.`,
    ),
    div('notice__actions', [
      el('button', {
        class: 'button button--primary',
        text: 'Save it',
        attrs: { type: 'button' },
        on: {
          click: () => {
            const saved = context.store.keepStaleActive();
            toast(saved ? 'Session saved to history' : 'Nothing in it to save');
            if (!saved) context.store.discardActive();
            context.render();
          },
        },
      }),
      el('button', {
        class: 'button button--ghost',
        text: 'Discard',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (!confirm('Discard that unfinished session? This cannot be undone.')) return;
            context.store.discardActive();
            toast('Discarded');
            context.render();
          },
        },
      }),
    ]),
  ]);
}

function renderBody(context: ViewContext, dayKey: DayKey, day: PlanDay): Child[] {
  const finished = todaysSession(context.state, dayKey, todayIso());

  // A finished session for this day takes over the view, unless the user has
  // reopened it and is adding to it.
  if (finished && !context.store.activeFor(dayKey)) {
    return [renderSummaryCard(context, finished, day)];
  }

  return [
    ...(day.exercises ? renderLogger(context, dayKey, day) : []),
    day.type === 'strength' ? null : renderDuration(context, dayKey, day),
    renderFinishButton(context, dayKey, day),
  ];
}

/* ------------------------------------------------------------------ logger */

function renderLogger(context: ViewContext, dayKey: DayKey, day: PlanDay): Child[] {
  const exercises = day.exercises ?? [];
  if (exercises.length === 0) return [];

  const index = Math.min(Math.max(context.ui.exerciseIndex, 0), exercises.length - 1);
  context.ui.exerciseIndex = index;

  const exercise = exercises[index];
  if (!exercise) return [];

  const active = context.store.activeFor(dayKey);
  const logged = active?.sets.filter((set) => set.exerciseId === exercise.id) ?? [];

  const rail = el(
    'div',
    { class: 'rail', attrs: { role: 'tablist', 'aria-label': 'Exercises' } },
    exercises.map((item, itemIndex) => {
      const count = active?.sets.filter((set) => set.exerciseId === item.id).length ?? 0;
      const complete = count >= item.sets;

      return el('button', {
        class: complete ? 'rail__item is-done' : 'rail__item',
        text: item.name,
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': itemIndex === index,
          'aria-label': `${item.name}, ${count} of ${item.sets} sets logged`,
        },
        on: {
          click: () => {
            context.ui.exerciseIndex = itemIndex;
            context.ui.swapOpenFor = null;
            context.render();
          },
        },
      });
    }),
  );

  // The chosen station is per-exercise transient state: an explicit pick this
  // session wins, otherwise fall back to the remembered or default station.
  const stationId =
    context.ui.stationByExercise[exercise.id] ?? defaultStationId(exercise, context.state.prefs);

  const cardEl = renderExerciseCard({
    exercise,
    logged,
    previous: lastPerformance(context.state, exercise.id),
    unit: context.state.prefs.unit,
    prefs: context.state.prefs,
    stationId,
    swapOpen: context.ui.swapOpenFor === exercise.id,
    draft: context.ui.draftByExercise[exercise.id],
    onDraftChange: (draft) => {
      // Deliberately no re-render: this fires on every keystroke, and the
      // value is only needed the next time something else triggers one.
      context.ui.draftByExercise[exercise.id] = draft;
    },
    onToggleSwap: () => {
      context.ui.swapOpenFor = context.ui.swapOpenFor === exercise.id ? null : exercise.id;
      context.render();
    },
    onChooseStation: (chosenId, suggestedWeight) => {
      context.ui.stationByExercise[exercise.id] = chosenId;
      context.ui.swapOpenFor = null;
      // Carry the converted load into the steppers for the coming render.
      if (suggestedWeight !== null) {
        const current = context.ui.draftByExercise[exercise.id];
        context.ui.draftByExercise[exercise.id] = {
          weight: suggestedWeight,
          reps: current?.reps ?? exercise.defaultReps,
        };
      }
      // Remember it, so a station you keep swapping to becomes the default.
      context.store.setPreferredStation(exercise.id, chosenId);
      toast(`Switched to ${stationName(chosenId)}`);
      context.render();
    },
    onToggleMissingStation: (id, missing) => {
      context.store.setStationMissing(id, missing);
      toast(missing ? `${stationName(id)} marked as not at your club` : `${stationName(id)} restored`);
      context.render();
    },
    onLog: (weight, reps) => {
      context.store.logSet(dayKey, exercise.id, weight, reps, context.state.prefs.unit, stationId);
      context.rest.start(exercise.restSeconds);
      // The set is recorded, so the next one should seed from it, not from the
      // stale draft.
      delete context.ui.draftByExercise[exercise.id];

      // Advance once this exercise's target is met, so the common path is
      // "log, log, log" without ever touching the rail.
      const nowLogged =
        context.store.activeFor(dayKey)?.sets.filter((set) => set.exerciseId === exercise.id).length ?? 0;
      if (nowLogged >= exercise.sets && index < exercises.length - 1) {
        context.ui.exerciseIndex = index + 1;
      }
      context.render();
    },
    onUndo: () => {
      context.store.undoLastSet(dayKey, exercise.id);
      delete context.ui.draftByExercise[exercise.id];
      context.render();
    },
  });

  return [rail, cardEl];
}

function renderDuration(context: ViewContext, dayKey: DayKey, day: PlanDay): HTMLElement {
  const fallbackMinutes = day.minutes ?? null;

  return renderDurationCard({
    day,
    active: context.store.activeFor(dayKey),
    prefs: context.state.prefs,
    onMinutes: (minutes) => context.store.setMinutes(dayKey, minutes),
    onModality: (modality) => {
      context.store.toggleModality(dayKey, modality, fallbackMinutes);
      context.render();
    },
    onEffort: (effort) => {
      context.store.toggleEffort(dayKey, effort, fallbackMinutes);
      context.render();
    },
  });
}

function renderFinishButton(context: ViewContext, dayKey: DayKey, day: PlanDay): HTMLElement {
  return el('button', {
    class: 'button button--primary button--finish',
    text: 'Finish session',
    attrs: { type: 'button' },
    on: {
      click: () => {
        // Pure strength days have no default duration to fall back on.
        const defaultMinutes = day.type === 'strength' ? null : (day.minutes ?? null);

        if (!context.store.finishActive(dayKey, defaultMinutes)) {
          toast('Log a set or some minutes first');
          return;
        }

        context.ui.exerciseIndex = 0;
        context.rest.stop();
        toast('Session saved');
        context.render();
      },
    },
  });
}

/* ----------------------------------------------------------------- summary */

function renderSummaryCard(context: ViewContext, session: Session, day: PlanDay): HTMLElement {
  return card([
    eyebrow('Logged today'),
    ...describeLines(session, context).map((line) => text('summary__line', line)),
    el('button', {
      class: 'button button--ghost',
      text: 'Add more to today',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (!context.store.reopenSession(session.id)) {
            toast('Finish the session in progress first');
            return;
          }
          context.ui.exerciseIndex = 0;
          context.render();
        },
      },
    }),
    text('summary__note', `${day.label} · ${formatShortDate(session.date)}`),
  ]);
}

function describeLines(session: Session, context: ViewContext): string[] {
  const unit = context.state.prefs.unit;
  const lines: string[] = [];

  if (session.sets.length > 0) {
    const volume = sessionVolume(session.sets, unit);
    lines.push(
      volume > 0
        ? `${session.sets.length} sets · ${formatVolume(volume, unit)} total volume`
        : `${session.sets.length} sets`,
    );
  }

  if (session.minutes) {
    const parts = [`${session.minutes} minutes`, session.modality, session.effort].filter(Boolean);
    lines.push(parts.join(' · '));
  }

  return lines;
}

function describeSession(session: Session, context: ViewContext): string {
  if (AppStore.isEmptySession(session)) return 'nothing was logged';
  const parts = describeLines(session, context);
  return parts.length > 0 ? parts.join(', ') : 'nothing was logged';
}
