import type { DayKey, SetEffort, WeightUnit } from '@/types';
import type { Attention } from '@/services/attention';
import { formatClock } from '@/domain/dates';
import { clampRestSeconds } from '@/domain/limits';
import { UNIT_LABEL, formatWeightValue } from '@/domain/units';
import { clear, el, requireElement } from './dom';
import { toast } from './toast';

/**
 * The rest between sets.
 *
 * Driven by a wall-clock deadline rather than by decrementing a counter each
 * tick. Phone browsers throttle or suspend timers in a backgrounded tab, so a
 * counting-down approach loses time exactly when it matters — the screen is off
 * and the user is mid-set. Recomputing from `Date.now()` means the display is
 * correct the instant the tab is visible again, however long it was away.
 *
 * Rest takes the whole screen. It used to be a 16px stack of ten pips and a
 * 26px clock in a strip behind the tab bar — correct, and invisible, which is
 * why it felt like you had to keep checking. During rest there is nothing else
 * to do and the value of a glance from three metres away is high, so the screen
 * is the countdown, the set that was just done, and one question about it.
 */

const SEGMENTS = 10;
const TICK_MS = 200;
const VIBRATION_PATTERN = [120, 60, 120];

/** Seconds left when the two short beeps fire. */
const WARNING_AT = 10;

/** What the rest screen says about the set that started it. */
export interface RestPrompt {
  readonly dayKey: DayKey;
  readonly exerciseId: string;
  /** The movement's name, for the line above the clock. */
  readonly exerciseName: string;
  /** Which set of how many was just logged, e.g. `set 3 of 3`. */
  readonly setLabel: string;
  readonly weight: number;
  readonly reps: number;
  readonly unit: WeightUnit;
  /** The plan day's name, e.g. `Strength A`. */
  readonly planLabel: string;
  /** The effort already recorded for that set, if any. */
  readonly effort: SetEffort | undefined;
  /** Record — or, on the same value again, clear — how the set felt. */
  readonly onEffort: (effort: SetEffort) => void;
  /** What is up next, for the go screen and the spoken cue. */
  readonly next: RestNext | null;
}

/** The movement the go screen sends you to. */
export interface RestNext {
  readonly name: string;
  /** `Set 1 of 3`, or the circuit round. */
  readonly setLabel: string;
  readonly weight: number;
  readonly reps: number;
  readonly unit: WeightUnit;
  /** Where to do it, when the movement has a station. */
  readonly where: string | null;
}

export interface RestTimerOptions {
  /** Whether completion should buzz the device, where supported. */
  readonly shouldVibrate: () => boolean;
  /** Whether the chime plays. The tone needs no asset, only a user gesture. */
  readonly shouldChime: () => boolean;
  /** Whether the next movement is read out loud. Off by default. */
  readonly shouldSpeak: () => boolean;
  readonly attention: Attention;
}

export class RestTimer {
  readonly #root: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #stack: HTMLElement;
  readonly #plan: HTMLElement;
  readonly #did: HTMLElement;
  readonly #effort: HTMLElement;
  readonly #ask: HTMLElement;
  readonly #warning: HTMLElement;
  readonly #running: HTMLElement;
  readonly #over: HTMLElement;
  readonly #next: HTMLElement;
  readonly #load: HTMLElement;
  readonly #nextMeta: HTMLElement;
  readonly #options: RestTimerOptions;

  #deadline = 0;
  #totalSeconds = 0;
  #ticker: ReturnType<typeof setInterval> | undefined;
  #prompt: RestPrompt | null = null;
  #warned = false;

  constructor(options: RestTimerOptions) {
    this.#options = options;
    this.#root = requireElement('#rest');
    this.#clock = requireElement('#rest-clock');
    this.#stack = requireElement('#rest-stack');
    this.#plan = requireElement('#rest-plan');
    this.#did = requireElement('#rest-did');
    this.#effort = requireElement('#rest-effort');
    this.#ask = requireElement('#rest-ask');
    this.#warning = requireElement('#rest-warning');
    this.#running = requireElement('#rest-running');
    this.#over = requireElement('#rest-over');
    this.#next = requireElement('#rest-next');
    this.#load = requireElement('#rest-load');
    this.#nextMeta = requireElement('#rest-nextmeta');

    requireElement('#rest-add').addEventListener('click', () => this.add(30));
    requireElement('#rest-skip').addEventListener('click', () => this.stop());
    requireElement('#rest-go').addEventListener('click', () => this.stop());

    for (const button of this.#effort.querySelectorAll<HTMLButtonElement>('[data-effort]')) {
      button.addEventListener('click', () => {
        const value = button.dataset.effort as SetEffort | undefined;
        if (!value || !this.#prompt) return;
        this.#prompt.onEffort(value);
      });
    }

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

  start(seconds: number, prompt?: RestPrompt): void {
    const duration = clampRestSeconds(seconds);
    if (duration <= 0) return;

    this.#prompt = prompt ?? null;
    this.#totalSeconds = duration;
    this.#deadline = Date.now() + duration * 1000;
    this.#warned = false;
    this.#showRunning();
    this.#root.hidden = false;
    this.#render();

    if (this.#ticker === undefined) {
      this.#ticker = setInterval(() => this.#tick(), TICK_MS);
    }
  }

  /**
   * Update the effort shown, without disturbing the countdown.
   *
   * The answer is written to the store, which re-renders the view underneath;
   * the rest screen is outside that view, so it is told separately rather than
   * being rebuilt and losing its deadline.
   */
  setEffort(effort: SetEffort | undefined): void {
    if (!this.#prompt) return;
    this.#prompt = { ...this.#prompt, effort };
    this.#paintEffort();
  }

  /** Extend the current rest. Does nothing when the timer is not running. */
  add(seconds: number): void {
    if (!this.isRunning) return;
    this.#deadline += clampRestSeconds(seconds) * 1000;
    // Keep the depleting stack meaningful when rest is extended past its start.
    this.#totalSeconds = Math.max(this.#totalSeconds, this.remaining);
    this.#render();
  }

  /** Stop and hide the screen without announcing completion. */
  stop(): void {
    if (this.#ticker !== undefined) {
      clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
    this.#deadline = 0;
    this.#prompt = null;
    this.#warned = false;
    this.#showRunning();
    this.#root.hidden = true;
  }

  #tick(): void {
    const remaining = this.remaining;

    if (remaining > 0) {
      // Two short beeps ten seconds out, so the next set can be walked back
      // to rather than started from a standstill.
      if (!this.#warned && remaining <= WARNING_AT) {
        this.#warned = true;
        if (this.#options.shouldChime()) this.#options.attention.warn();
      }
      this.#render();
      return;
    }

    this.#stopTicking();
    this.#announceComplete();
  }

  #stopTicking(): void {
    if (this.#ticker !== undefined) {
      clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
    this.#deadline = 0;
  }

  /**
   * Rest is over, said in every register the device has.
   *
   * The screen flips green — a whole-screen colour change is the only signal
   * that survives being read across a gym floor — and stays there until the go
   * button is pressed, with the next movement and its weight already on it.
   */
  #announceComplete(): void {
    if (this.#options.shouldVibrate() && typeof navigator.vibrate === 'function') {
      // Ignored by browsers without a user-activation history; harmless there.
      navigator.vibrate(VIBRATION_PATTERN);
    }
    if (this.#options.shouldChime()) this.#options.attention.complete();

    const next = this.#prompt?.next ?? null;

    if (!next) {
      this.stop();
      toast('Rest complete');
      return;
    }

    if (this.#options.shouldSpeak()) this.#options.attention.speak(spokenCue(next));

    this.#next.textContent = next.name;
    this.#load.textContent = describeLoad(next);
    this.#nextMeta.textContent = [next.setLabel, next.where].filter(Boolean).join(' · ');
    this.#root.setAttribute('aria-label', `Rest over. Next: ${next.name}, ${describeLoad(next)}`);
    this.#showOver();
  }

  #showRunning(): void {
    this.#root.dataset.state = 'running';
    this.#running.hidden = false;
    this.#over.hidden = true;
  }

  #showOver(): void {
    this.#root.dataset.state = 'over';
    this.#running.hidden = true;
    this.#over.hidden = false;
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

    this.#paintPrompt();
  }

  #paintPrompt(): void {
    const prompt = this.#prompt;

    this.#plan.textContent = prompt?.planLabel ?? '';
    this.#did.textContent = prompt ? `${prompt.exerciseName} · ${prompt.setLabel} logged` : '';
    this.#effort.hidden = prompt === null;

    // Said once, in the one place it matters, rather than pretending the phone
    // will still be lit when rest ends.
    const refused = this.#options.attention.wakeLockRefused;
    this.#warning.hidden = !refused;
    this.#warning.textContent = refused
      ? 'This browser will not keep the screen on, so it may go dark before rest ends.'
      : '';

    if (!prompt) return;

    const load =
      prompt.weight > 0
        ? `${formatWeightValue(prompt.weight, prompt.unit)} ${UNIT_LABEL[prompt.unit]} × ${prompt.reps}`
        : `${prompt.reps} reps`;
    this.#ask.textContent = `How did ${load} feel?`;
    this.#paintEffort();
  }

  #paintEffort(): void {
    for (const button of this.#effort.querySelectorAll<HTMLButtonElement>('[data-effort]')) {
      button.setAttribute('aria-pressed', String(button.dataset.effort === this.#prompt?.effort));
    }
  }
}

/** `95 lb × 10`, or just the reps for a bodyweight movement. */
function describeLoad(next: RestNext): string {
  return next.weight > 0
    ? `${formatWeightValue(next.weight, next.unit)} ${UNIT_LABEL[next.unit]} × ${next.reps}`
    : `${next.reps} reps`;
}

/**
 * The one line worth hearing.
 *
 * Deliberately short — it replaces the glance, not the screen — and spelled out
 * rather than punctuated, because a speech engine reads `95 lb × 10` as three
 * unrelated tokens.
 */
function spokenCue(next: RestNext): string {
  const unit = next.unit === 'kg' ? 'kilos' : 'pounds';
  return next.weight > 0
    ? `${next.name}. ${formatWeightValue(next.weight, next.unit)} ${unit}, ${next.reps} reps.`
    : `${next.name}. ${next.reps} reps.`;
}
