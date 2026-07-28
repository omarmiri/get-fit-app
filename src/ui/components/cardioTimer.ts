import { formatClock } from '@/domain/dates';
import { div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';

/**
 * A run clock for the cardio portion of a session.
 *
 * Typing "45" into a box after the fact is fine for logging but useless while
 * you are actually on the treadmill, which is where you want to know how long
 * is left. This counts the session down, survives the screen going off, and
 * writes the *actual* elapsed time into the log rather than the planned time.
 *
 * Like the rest timer, it is driven by wall-clock timestamps rather than by
 * decrementing a counter: phone browsers throttle timers in a backgrounded tab,
 * and the screen is off for most of a 45-minute run.
 *
 * Pausing is a first-class state, not an afterthought — stepping off for water
 * or to let a machine free up is normal, and the paused time should not count
 * toward the session.
 */

/** Timer state, held in `UiState` so a re-render cannot disturb a running clock. */
export interface CardioTimerState {
  readonly targetSeconds: number;
  /** Milliseconds banked from previous running segments. */
  readonly accumulatedMs: number;
  /** When the current running segment began, or `null` while paused. */
  readonly startedAt: number | null;
}

export interface CardioTimerOptions {
  readonly targetMinutes: number;
  readonly state: CardioTimerState | null;
  readonly shouldVibrate: boolean;
  readonly onStart: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  /** Finish and write the elapsed minutes to the session. */
  readonly onFinish: (elapsedMinutes: number) => void;
  readonly onReset: () => void;
}

/** Total time actually spent running, paused segments excluded. */
export function elapsedMs(state: CardioTimerState, now = Date.now()): number {
  return state.accumulatedMs + (state.startedAt === null ? 0 : now - state.startedAt);
}

export function elapsedMinutes(state: CardioTimerState, now = Date.now()): number {
  return Math.max(0, Math.round(elapsedMs(state, now) / 60_000));
}

/** True once the planned duration has been reached. */
export function hasReachedTarget(state: CardioTimerState, now = Date.now()): boolean {
  return elapsedMs(state, now) >= state.targetSeconds * 1000;
}

/*
 * One module-level ticker drives the clock. The view is rebuilt on every
 * render, so the interval is re-pointed at the current nodes each time and
 * stops itself once they leave the document — otherwise every render would
 * leak another interval.
 */
let ticker: ReturnType<typeof setInterval> | undefined;
let announcedCompletion = false;

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

/** Clear ticker bookkeeping when the timer is reset or the day changes. */
export function resetCardioTicker(): void {
  stopTicker();
  announcedCompletion = false;
}

export function renderCardioTimer(options: CardioTimerOptions): HTMLElement {
  const { state, targetMinutes } = options;

  if (!state) {
    return div('cardio', [
      div('cardio__head', [eyebrow('Run clock'), text('cardio__target', `${targetMinutes} min planned`)]),
      text('cardio__hint', 'Start the clock and it will count down while you go. You can pause it.'),
      el('button', {
        class: 'button button--primary',
        text: `Start ${targetMinutes} minutes`,
        attrs: { type: 'button' },
        on: { click: options.onStart },
      }),
    ]);
  }

  const running = state.startedAt !== null;
  const clock = el('div', {
    class: 'cardio__clock mono',
    attrs: { id: 'cardio-clock', role: 'timer', 'aria-label': 'Time remaining' },
  });
  const bar = el('div', { class: 'cardio__fill', attrs: { id: 'cardio-fill' } });
  const status = text('cardio__status', running ? 'Running' : 'Paused');

  paint(state, clock, bar, options.shouldVibrate);
  bindTicker(state, options);

  return div(running ? 'cardio is-running' : 'cardio is-paused', [
    div('cardio__head', [eyebrow('Run clock'), status]),
    clock,
    div('cardio__track', [bar]),

    div('cardio__actions', [
      running
        ? el('button', {
            class: 'button button--ghost',
            text: 'Pause',
            attrs: { type: 'button' },
            on: { click: options.onPause },
          })
        : el('button', {
            class: 'button button--ghost',
            text: 'Resume',
            attrs: { type: 'button' },
            on: { click: options.onResume },
          }),

      el('button', {
        class: 'button button--primary',
        // "Finish early" would be wrong once the clock has run out, and
        // "Finish" alone hides that stopping now is allowed.
        text: hasReachedTarget(state) ? 'Finish and log' : 'Finish early and log',
        attrs: { type: 'button' },
        on: {
          click: () => {
            const minutes = elapsedMinutes(state);
            resetCardioTicker();
            options.onFinish(minutes);
          },
        },
      }),
    ]),

    el('button', {
      class: 'cardio__discard',
      text: 'Discard the clock',
      attrs: { type: 'button', 'aria-label': 'Discard the run clock without logging' },
      on: {
        click: () => {
          resetCardioTicker();
          options.onReset();
        },
      },
    }),
  ]);
}

/** Update the clock and bar in place, without re-rendering the whole view. */
function paint(state: CardioTimerState, clock: HTMLElement, bar: HTMLElement, shouldVibrate: boolean): void {
  const elapsed = elapsedMs(state);
  const targetMs = state.targetSeconds * 1000;
  const remaining = Math.round((targetMs - elapsed) / 1000);

  // Past the target, count *up* in overtime rather than showing a stuck 0:00 —
  // going long is normal and the extra minutes still count.
  clock.textContent = remaining >= 0 ? formatClock(remaining) : `+${formatClock(-remaining)}`;
  clock.setAttribute(
    'aria-label',
    remaining >= 0
      ? `${formatClock(remaining)} remaining`
      : `${formatClock(-remaining)} past the planned time`,
  );
  clock.classList.toggle('is-overtime', remaining < 0);

  const progress = targetMs > 0 ? Math.min(100, (elapsed / targetMs) * 100) : 0;
  bar.style.width = `${progress}%`;

  if (remaining < 0 && !announcedCompletion) {
    announcedCompletion = true;
    if (shouldVibrate && typeof navigator.vibrate === 'function') {
      navigator.vibrate([200, 100, 200]);
    }
    toast('Planned time reached — finish when you are ready');
  }
}

function bindTicker(state: CardioTimerState, options: CardioTimerOptions): void {
  stopTicker();
  if (state.startedAt === null) return;

  ticker = setInterval(() => {
    const clock = document.getElementById('cardio-clock');
    const bar = document.getElementById('cardio-fill');

    // The view was rebuilt without the timer — stop rather than leak.
    if (!clock || !bar) {
      stopTicker();
      return;
    }

    paint(state, clock, bar, options.shouldVibrate);
  }, 1000);
}
