import { div, el, eyebrow, text } from '../dom';

/**
 * Starting the session.
 *
 * The app already knew when a session began, but only implicitly — the first
 * logged set created the session, so the timestamp recorded the first working
 * set rather than walking in the door. That made the one number a training log
 * should be able to answer, "how long was I there", unanswerable.
 *
 * Once it is running the clock is a phrase in the mid-workout header
 * (`22:01 in`), not a card. It used to be 34px of counter in a box of its own —
 * a fifth of the screen you read standing up, given to a number nobody acts on.
 *
 * There is no pause. A gym session is not a stopwatch event — the rest between
 * sets, the queue for a rack and the walk across the floor are all part of how
 * long it took, and asking the user to police that would be busywork.
 */

export interface SessionClockOptions {
  readonly onStart: () => void;
}

/** Minutes elapsed since the session began, rounded to whole minutes. */
export function elapsedSessionMinutes(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.round((now - startedAt) / 60_000));
}

export function renderSessionClock(options: SessionClockOptions): HTMLElement {
  return div('sessclock', [
    div('sessclock__head', [eyebrow('Session'), text('sessclock__status', 'Not started')]),
    text(
      'sessclock__hint',
      'Start the clock when you walk in and the finished session records how long it took.',
    ),
    el('button', {
      class: 'button button--primary',
      text: 'Start workout',
      attrs: { type: 'button' },
      on: { click: options.onStart },
    }),
  ]);
}
