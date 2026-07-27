import { formatClock } from '@/domain/dates';
import { clampRestSeconds } from '@/domain/limits';
import { clear, el, requireElement } from './dom';
import { toast } from './toast';

/**
 * The rest timer between sets.
 *
 * Driven by a wall-clock deadline rather than by decrementing a counter each
 * tick. Phone browsers throttle or suspend timers in a backgrounded tab, so a
 * counting-down approach loses time exactly when it matters — the screen is off
 * and the user is mid-set. Recomputing from `Date.now()` means the display is
 * correct the instant the tab is visible again, however long it was away.
 */

const SEGMENTS = 10;
const TICK_MS = 200;
const VIBRATION_PATTERN = [120, 60, 120];

export interface RestTimerOptions {
  /** Whether completion should buzz the device, where supported. */
  readonly shouldVibrate: () => boolean;
}

export class RestTimer {
  readonly #root: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #stack: HTMLElement;
  readonly #options: RestTimerOptions;

  #deadline = 0;
  #totalSeconds = 0;
  #ticker: ReturnType<typeof setInterval> | undefined;

  constructor(options: RestTimerOptions) {
    this.#options = options;
    this.#root = requireElement('#rest');
    this.#clock = requireElement('#rest-clock');
    this.#stack = requireElement('#rest-stack');

    requireElement('#rest-add').addEventListener('click', () => this.add(30));
    requireElement('#rest-skip').addEventListener('click', () => this.stop());

    // Re-sync immediately on return rather than waiting for the next tick.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isRunning) this.#tick();
    });
  }

  get isRunning(): boolean {
    return this.#ticker !== undefined;
  }

  /** Seconds left, floored at zero. */
  get remaining(): number {
    return Math.max(0, Math.ceil((this.#deadline - Date.now()) / 1000));
  }

  start(seconds: number): void {
    const duration = clampRestSeconds(seconds);
    if (duration <= 0) return;

    this.#totalSeconds = duration;
    this.#deadline = Date.now() + duration * 1000;
    this.#root.hidden = false;
    this.#render();

    if (this.#ticker === undefined) {
      this.#ticker = setInterval(() => this.#tick(), TICK_MS);
    }
  }

  /** Extend the current rest. Does nothing when the timer is not running. */
  add(seconds: number): void {
    if (!this.isRunning) return;
    this.#deadline += clampRestSeconds(seconds) * 1000;
    // Keep the depleting stack meaningful when rest is extended past its start.
    this.#totalSeconds = Math.max(this.#totalSeconds, this.remaining);
    this.#render();
  }

  /** Stop and hide the timer without announcing completion. */
  stop(): void {
    if (this.#ticker !== undefined) {
      clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
    this.#deadline = 0;
    this.#root.hidden = true;
  }

  #tick(): void {
    if (this.remaining > 0) {
      this.#render();
      return;
    }
    this.stop();
    this.#announceComplete();
  }

  #announceComplete(): void {
    if (this.#options.shouldVibrate() && typeof navigator.vibrate === 'function') {
      // Ignored by browsers without a user-activation history; harmless there.
      navigator.vibrate(VIBRATION_PATTERN);
    }
    toast('Rest complete');
  }

  #render(): void {
    const remaining = this.remaining;
    this.#clock.textContent = formatClock(remaining);
    this.#root.setAttribute('aria-label', `Rest, ${formatClock(remaining)} remaining`);

    const lit = this.#totalSeconds > 0 ? Math.ceil((remaining / this.#totalSeconds) * SEGMENTS) : 0;

    clear(this.#stack);
    for (let i = 0; i < SEGMENTS; i += 1) {
      this.#stack.appendChild(el('i', { class: i < lit ? 'is-loaded' : '' }));
    }
  }
}
