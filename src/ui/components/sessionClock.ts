import { formatDuration, formatElapsed, formatTimeOfDay } from '@/domain/dates';
import { div, el, eyebrow, text } from '../dom';

/**
 * The session clock: when the workout started, and how long it has been running.
 *
 * The app already knew when a session began, but only implicitly — the first
 * logged set created the session, so the timestamp recorded the first working
 * set rather than walking in the door. That made the one number a training log
 * should be able to answer, "how long was I there", unanswerable.
 *
 * Like the cardio and rest timers, this reads wall-clock timestamps rather than
 * decrementing a counter. A phone browser throttles timers in a backgrounded
 * tab and the screen is off for most of a session, so anything that counts
 * ticks would drift badly over an hour.
 *
 * There is no pause. A gym session is not a stopwatch event — the rest between
 * sets, the queue for a rack and the walk across the floor are all part of how
 * long it took, and asking the user to police that would be busywork.
 */

export interface SessionClockOptions {
  /** Epoch milliseconds the session began, or `null` when it has not. */
  readonly startedAt: number | null;
  readonly onStart: () => void;
}

/*
 * One module-level ticker drives the clock. The view is rebuilt on every
 * render, so the interval is re-pointed at the current node each time and stops
 * itself once that node leaves the document — otherwise every render would leak
 * another interval.
 */
let ticker: ReturnType<typeof setInterval> | undefined;

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

/** Stop the ticker. Called when a session ends or the viewed day changes. */
export function resetSessionTicker(): void {
  stopTicker();
}

/** Minutes elapsed since the session began, rounded to whole minutes. */
export function elapsedSessionMinutes(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.round((now - startedAt) / 60_000));
}

export function renderSessionClock(options: SessionClockOptions): HTMLElement {
  const { startedAt } = options;

  if (startedAt === null) {
    stopTicker();

    return div('sessclock', [
      div('sessclock__head', [eyebrow('Session'), text('sessclock__status', 'Not started')]),
      text(
        'sessclock__hint',
        'Start the clock when you walk in and the finished session records how long it took. Logging a set starts it too.',
      ),
      el('button', {
        class: 'button button--primary',
        text: 'Start workout',
        attrs: { type: 'button' },
        on: { click: options.onStart },
      }),
    ]);
  }

  const clock = el('div', {
    class: 'sessclock__time mono',
    attrs: { id: 'session-clock', role: 'timer', 'aria-label': 'Time since the session started' },
  });

  paint(startedAt, clock);
  bindTicker(startedAt);

  return div('sessclock is-running', [
    div('sessclock__head', [eyebrow('Session'), text('sessclock__status', 'Running')]),
    clock,
    text('sessclock__since', `Started ${formatTimeOfDay(startedAt)}`),
  ]);
}

function paint(startedAt: number, clock: HTMLElement): void {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  clock.textContent = formatElapsed(seconds);
  // Screen readers get the rounded human duration; a second-by-second
  // announcement of `42:07` would be unusable.
  clock.setAttribute('aria-label', `${formatDuration(seconds / 60)} since the session started`);
}

function bindTicker(startedAt: number): void {
  stopTicker();

  ticker = setInterval(() => {
    const clock = document.getElementById('session-clock');

    // The view was rebuilt without the clock — stop rather than leak.
    if (!clock) {
      stopTicker();
      return;
    }

    paint(startedAt, clock);
  }, 1000);
}
