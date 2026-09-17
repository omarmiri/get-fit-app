import type { Exercise } from '@/types';
import { el } from '../dom';

/**
 * One progress bar per movement, across the top of the mid-workout screen.
 *
 * This replaces the scrolling rail of named buttons and the two lines of
 * instruction under it. The rail spent a full screen-width on text you have
 * already read, and the instruction was only needed because tapping a name was
 * not an obvious thing to do. Six bars are the shape of the session — how many
 * movements, how far through each — in about ten pixels of height, and tapping
 * one still jumps to it.
 *
 * The bar is a 6px rule inside a 44px target: thin to look at, comfortable to
 * hit with a thumb.
 */

export interface MovementBarsOptions {
  readonly exercises: readonly Exercise[];
  /** Sets logged so far for each exercise, in the same order. */
  readonly counts: readonly number[];
  readonly currentIndex: number;
  readonly onSelect: (index: number) => void;
}

export function renderMovementBars(options: MovementBarsOptions): HTMLElement {
  const bars = options.exercises.map((exercise, index) => {
    const done = options.counts[index] ?? 0;
    const fraction = exercise.sets > 0 ? Math.min(1, done / exercise.sets) : 0;
    const current = index === options.currentIndex;

    return el(
      'button',
      {
        class: 'movebar',
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': current,
          'aria-label': `${exercise.name}, ${done} of ${exercise.sets} sets logged`,
          'data-current': current,
        },
        on: { click: () => options.onSelect(index) },
      },
      [
        el('i', { class: 'movebar__track' }, [
          el('i', { class: 'movebar__fill', style: { width: `${Math.round(fraction * 100)}%` } }),
        ]),
      ],
    );
  });

  return el(
    'div',
    {
      class: 'movebars',
      attrs: { role: 'tablist', 'aria-label': 'Movements in this session' },
      style: { '--movebar-count': String(bars.length) },
    },
    bars,
  );
}
