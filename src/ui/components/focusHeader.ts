import type { Child } from '../dom';
import { formatDuration, formatElapsed } from '@/domain/dates';
import { div, el, text } from '../dom';

/**
 * The header of the mid-workout screen.
 *
 * Three lines of chrome doing the work of five blocks: which session this is,
 * where you are in it, how long you have been here — and two disclosures for
 * everything that used to sit on the screen permanently.
 *
 * The session clock used to be a card of its own with a 34px running counter,
 * which is a number nobody acts on taking a fifth of the screen you read
 * standing up. It is `22:01 in` here, in the same line as the movement count.
 */

export interface FocusHeaderOptions {
  /** The plan day's name, e.g. `Strength A`. */
  readonly title: string;
  /** `Movement 1 of 6`, or null on a day with no movement list. */
  readonly position: string | null;
  /** Epoch milliseconds the session began. */
  readonly startedAt: number | null;
  /** What goes behind the `i` — pre-session reading and the weekly goals. */
  readonly reference: readonly Child[];
  /** What goes behind the `⋯` — undo, cues, finish. */
  readonly menu: readonly Child[];
  /** Which disclosure is open, so a re-render does not close it. */
  readonly openSheet: 'reference' | 'menu' | null;
  readonly onToggleSheet: (sheet: 'reference' | 'menu' | null) => void;
}

/*
 * One module-level ticker drives the elapsed readout, re-pointed at the current
 * node on each render and stopping itself once that node leaves the document.
 * Same shape as the session clock it replaces — without this, every render
 * would leak another interval.
 */
const CLOCK_ID = 'focus-elapsed';
let ticker: ReturnType<typeof setInterval> | undefined;

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

/** Stop the ticker. Called when a session ends or the viewed day changes. */
export function resetFocusTicker(): void {
  stopTicker();
}

export function renderFocusHeader(options: FocusHeaderOptions): HTMLElement {
  const elapsed = el('span', {
    class: 'focushead__elapsed mono',
    attrs: { id: CLOCK_ID, role: 'timer' },
  });

  if (options.startedAt === null) {
    stopTicker();
    elapsed.textContent = '';
  } else {
    paint(options.startedAt, elapsed);
    bindTicker(options.startedAt);
  }

  const meta = [options.position, options.startedAt === null ? null : elapsed].filter(Boolean);

  const toggle = (sheet: 'reference' | 'menu', label: string, glyph: string): HTMLElement =>
    el('button', {
      class: options.openSheet === sheet ? 'focushead__tool is-open' : 'focushead__tool',
      text: glyph,
      attrs: {
        type: 'button',
        'aria-label': label,
        'aria-expanded': options.openSheet === sheet,
      },
      on: { click: () => options.onToggleSheet(options.openSheet === sheet ? null : sheet) },
    });

  return div('focushead', [
    div('focushead__bar', [
      div('focushead__titles', [
        text('focushead__title', options.title),
        meta.length > 0 ? div('focushead__meta', interleave(meta)) : null,
      ]),
      div('focushead__tools', [
        toggle('reference', 'What this session is, and how to run it', 'i'),
        toggle('menu', 'Session options', '⋯'),
      ]),
    ]),
    options.openSheet === 'reference' ? div('sheet', options.reference) : null,
    options.openSheet === 'menu' ? div('sheet sheet--menu', options.menu) : null,
  ]);
}

/** Join the meta parts with a middot, without putting one at either end. */
function interleave(parts: readonly Child[]): Child[] {
  const out: Child[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(el('span', { class: 'focushead__sep', text: '·' }));
    out.push(part);
  });
  return out;
}

function paint(startedAt: number, node: HTMLElement): void {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  node.textContent = `${formatElapsed(seconds)} in`;
  // Screen readers get the rounded human duration; announcing `42:07` every
  // second would be unusable.
  node.setAttribute('aria-label', `${formatDuration(seconds / 60)} since the session started`);
}

function bindTicker(startedAt: number): void {
  stopTicker();

  ticker = setInterval(() => {
    const node = document.getElementById(CLOCK_ID);

    // The view was rebuilt without the clock — stop rather than leak.
    if (!node) {
      stopTicker();
      return;
    }

    paint(startedAt, node);
  }, 1000);
}
