import type { Child } from '../dom';
import type { DayKey, PlanDay, Session } from '@/types';
import { DAY_NAMES } from '@/data/plan';
import { stationName } from '@/data/equipment';
import { defaultStationId, resolveOptions } from '@/domain/substitutions';
import { recommend } from '@/domain/progression';
import { startingWeight } from '@/domain/startingWeights';
import { performanceHistory } from '@/state/selectors';
import { formatDuration, formatShortDate, formatWithWeekday, todayDayKey, todayIso } from '@/domain/dates';
import { sessionVolume } from '@/domain/metrics';
import { formatVolume } from '@/domain/units';
import { lastPerformance, todaysSession } from '@/state/selectors';
import { AppStore } from '@/state/store';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderDurationCard } from '../components/durationCard';
import { renderExerciseCard } from '../components/exerciseCard';
import { renderGoalsCard } from '../components/goalsCard';
import { renderOnboarding } from '../components/onboarding';
import { elapsedMs, resetCardioTicker } from '../components/cardioTimer';
import { elapsedSessionMinutes, renderSessionClock, resetSessionTicker } from '../components/sessionClock';
import type { ViewContext } from './context';

/** The Today tab: the session for the selected plan day, and the controls to log it. */
export function renderTodayView(context: ViewContext): Child[] {
  const dayKey = context.ui.viewDay ?? todayDayKey();
  const day = context.plan[dayKey];

  // Setup comes first and replaces the session, so it is answered once rather
  // than nagging alongside the workout.
  if (!context.state.prefs.onboarded) {
    return [renderHeader(day), renderOnboardingCard(context)];
  }

  return [
    renderHeader(day),
    renderStaleBanner(context),
    renderDateNotice(context, dayKey),
    renderOutline(day),
    ...renderBody(context, dayKey, day),
    card([eyebrow('How to run it'), text('prose', day.note)]),
    renderGoalsCard(context.state, context.plan),
  ];
}

function renderOnboardingCard(context: ViewContext): HTMLElement {
  return renderOnboarding({
    unit: context.state.prefs.unit,
    onSave: (profile) => {
      context.store.setProfile(profile);
      toast('Starting weights set — adjust any of them as you go');
      context.render();
    },
    onSkip: () => {
      context.store.setOnboarded(true);
      context.render();
    },
  });
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
function renderDateNotice(context: ViewContext, dayKey: DayKey): HTMLElement | null {
  if (dayKey === todayDayKey()) return null;

  return div('notice', [
    text(
      'notice__body',
      `Viewing the ${context.plan[dayKey].label} plan. Anything you log is recorded against today, ${formatWithWeekday(todayIso())}.`,
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
      `You left a ${context.plan[stale.dayKey].label} session open on ${formatShortDate(stale.date)} — ${summary}.`,
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
    resetSessionTicker();
    return [renderSummaryCard(context, finished, day)];
  }

  const clock = renderSessionClockCard(context, dayKey);
  const logger = day.exercises ? renderLogger(context, dayKey, day) : [];
  const duration = day.type === 'strength' ? null : renderDuration(context, dayKey, day);

  // Mixed days are cardio *then* core. Rendering the exercises first told the
  // user to do them in the opposite order to the day's own instructions.
  return day.type === 'mixed'
    ? [clock, duration, ...logger, renderFinishButton(context, dayKey, day)]
    : [clock, ...logger, duration, renderFinishButton(context, dayKey, day)];
}

/**
 * The start button, or the running clock once the session is open.
 *
 * Starting is optional: logging a set opens the session too, and someone who
 * forgets to tap start still gets a duration measured from their first set
 * rather than nothing at all.
 */
function renderSessionClockCard(context: ViewContext, dayKey: DayKey): HTMLElement {
  const active = context.store.activeFor(dayKey);

  return renderSessionClock({
    startedAt: active?.startedAt ?? null,
    onStart: () => {
      context.store.startSession(dayKey);
      toast('Workout started — the clock is running');
      context.render();
    },
  });
}

/**
 * What this session actually is, in order, before any logging controls.
 *
 * The logger shows one exercise at a time, which makes a six-movement session
 * look like a one-movement session and a three-move circuit look like a choice
 * between three. This card is the answer to "wait, what am I doing today".
 */
function renderOutline(day: PlanDay): HTMLElement {
  return card([
    eyebrow("Today's session"),
    el(
      'ol',
      { class: 'outline' },
      day.outline.map((step) => el('li', { class: 'outline__step', text: step })),
    ),
  ]);
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

  const isCircuit = day.exerciseFormat === 'circuit';

  // How many times each movement has been done this session.
  const counts = exercises.map(
    (item) => active?.sets.filter((set) => set.exerciseId === item.id).length ?? 0,
  );
  const targetRounds = Math.max(...exercises.map((item) => item.sets));
  const roundsDone = Math.min(...counts);
  const allDone = exercises.every((item, i) => (counts[i] ?? 0) >= item.sets);

  const railHeading = allDone
    ? isCircuit
      ? `All ${targetRounds} rounds done — finish the session below`
      : `All ${exercises.length} movements done — finish the session below`
    : isCircuit
      ? `Round ${Math.min(roundsDone + 1, targetRounds)} of ${targetRounds} — one set of each, then round again`
      : `Work through all ${exercises.length}`;

  const railHeader = div(allDone ? 'railhead is-done' : 'railhead', [
    text('railhead__text', railHeading),
    text(
      'railhead__hint',
      isCircuit
        ? 'Logging a set moves you to the next movement automatically.'
        : 'Tap a name to jump to it. Logging a set moves you on automatically.',
    ),
  ]);

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

  // Progression runs on this exercise's history at *this* station: loads are
  // not comparable across machines.
  const blocks = performanceHistory(context.state, exercise.id, stationId);
  const stationOption = resolveOptions(exercise, context.state.prefs, null, context.state.prefs.unit).find(
    (entry) => entry.station.id === stationId,
  )?.option;

  const opening = startingWeight(
    exercise,
    context.state.prefs.profile,
    context.state.prefs.unit,
    stationOption,
  );

  const recommendation = recommend(exercise, blocks, context.state.prefs.unit, opening);

  const cardEl = renderExerciseCard({
    exercise,
    logged,
    previous: lastPerformance(context.state, exercise.id),
    unit: context.state.prefs.unit,
    prefs: context.state.prefs,
    stationId,
    swapOpen: context.ui.swapOpenFor === exercise.id,
    recommendation,
    logLabel: isCircuit
      ? `Log round ${Math.min(logged.length + 1, targetRounds)} — ${exercise.name}`
      : `Log set ${logged.length + 1}`,
    targetMet: logged.length >= exercise.sets,
    effort: context.ui.effortByExercise[exercise.id],
    onEffortChange: (effort) => {
      context.ui.effortByExercise[exercise.id] = effort;
      context.render();
    },
    onLogWithEffort: (weight, reps, effort) => {
      context.store.logSet(dayKey, exercise.id, weight, reps, context.state.prefs.unit, stationId, effort);
      context.rest.start(exercise.restSeconds);
      // The set is recorded, so the next one seeds from it rather than from the
      // stale draft, and the effort question starts fresh.
      delete context.ui.draftByExercise[exercise.id];
      delete context.ui.effortByExercise[exercise.id];

      /*
       * A circuit moves on after every single set and wraps round to the top
       * for the next round — that is what makes it a circuit. Straight sets
       * stay on the movement until its target is met.
       *
       * The old rule applied straight-set behaviour to both, so a core circuit
       * was silently logged as three sets of each movement in turn, which
       * contradicted the session outline printed directly above it.
       */
      const after = context.store.activeFor(dayKey)?.sets ?? [];
      const doneHere = after.filter((set) => set.exerciseId === exercise.id).length;

      if (isCircuit) {
        const finished = exercises.every(
          (item) => after.filter((set) => set.exerciseId === item.id).length >= item.sets,
        );
        // Stay put once every movement has hit its target, rather than looping
        // into a round nobody asked for.
        if (!finished) context.ui.exerciseIndex = (index + 1) % exercises.length;
      } else if (doneHere >= exercise.sets && index < exercises.length - 1) {
        context.ui.exerciseIndex = index + 1;
      }
      context.render();
    },
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
    onUndo: () => {
      context.store.undoLastSet(dayKey, exercise.id);
      delete context.ui.draftByExercise[exercise.id];
      context.render();
    },
  });

  return [railHeader, rail, cardEl];
}

function renderDuration(context: ViewContext, dayKey: DayKey, day: PlanDay): HTMLElement {
  const fallbackMinutes = day.minutes ?? null;

  const cardio = context.ui.cardioByDay[dayKey] ?? null;

  return renderDurationCard({
    day,
    active: context.store.activeFor(dayKey),
    prefs: context.state.prefs,
    cardio,
    onCardioStart: () => {
      context.ui.cardioByDay[dayKey] = {
        targetSeconds: (day.minutes ?? 30) * 60,
        accumulatedMs: 0,
        startedAt: Date.now(),
      };
      resetCardioTicker();
      context.render();
    },
    onCardioPause: () => {
      const current = context.ui.cardioByDay[dayKey];
      if (!current) return;
      // Bank the running segment so paused time never counts.
      context.ui.cardioByDay[dayKey] = {
        ...current,
        accumulatedMs: elapsedMs(current),
        startedAt: null,
      };
      context.render();
    },
    onCardioResume: () => {
      const current = context.ui.cardioByDay[dayKey];
      // Already running — resuming again would discard the current segment.
      if (current?.startedAt !== null || current === undefined) return;
      context.ui.cardioByDay[dayKey] = { ...current, startedAt: Date.now() };
      context.render();
    },
    onCardioFinish: (minutes) => {
      // The logged duration is what was actually run, not what was planned.
      context.store.setMinutes(dayKey, minutes);
      delete context.ui.cardioByDay[dayKey];
      toast(`${minutes} minutes logged`);
      context.render();
    },
    onCardioReset: () => {
      delete context.ui.cardioByDay[dayKey];
      context.render();
    },
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

        // Read the start stamp before finishing clears the active session, so
        // the confirmation can report how long it took.
        const startedAt = context.store.activeFor(dayKey)?.startedAt ?? null;

        if (!context.store.finishActive(dayKey, defaultMinutes)) {
          toast('Log a set or some minutes first');
          return;
        }

        context.ui.exerciseIndex = 0;
        context.rest.stop();
        resetSessionTicker();
        toast(
          startedAt === null || startedAt <= 0
            ? 'Session saved'
            : `Session saved — ${formatDuration(elapsedSessionMinutes(startedAt))}`,
        );
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

  // Last, and phrased differently from the aerobic minutes above it, because
  // the two are easy to confuse and only one of them counts toward the goal.
  if (session.durationMinutes) {
    lines.push(`${formatDuration(session.durationMinutes)} start to finish`);
  }

  return lines;
}

function describeSession(session: Session, context: ViewContext): string {
  if (AppStore.isEmptySession(session)) return 'nothing was logged';
  const parts = describeLines(session, context);
  return parts.length > 0 ? parts.join(', ') : 'nothing was logged';
}
