import type { AppState, DayKey, PlanDay } from '@/types';
import { DAY_KEYS, DAY_NAMES } from '@/data/plan';
import { addDays, startOfWeek, toIsoDate, todayDayKey } from '@/domain/dates';
import { completedDates } from '@/state/selectors';
import { el, replaceChildren } from '../dom';

/**
 * The seven-day strip pinned to the top of the app.
 *
 * Each cell is a button that switches the Today view to that plan day, tinted
 * with the day's plate colour and marked when a session was logged on that
 * calendar date.
 */

export interface WeekStripOptions {
  readonly state: AppState;
  /** The plan in force, so the strip reflects a generated week. */
  readonly plan: Readonly<Record<DayKey, PlanDay>>;
  /** The plan day currently on screen. */
  readonly selected: DayKey;
  readonly onSelect: (day: DayKey) => void;
  readonly now?: Date;
}

export function renderWeekStrip(container: HTMLElement, options: WeekStripOptions): void {
  const now = options.now ?? new Date();
  const weekBegan = startOfWeek(now);
  const done = completedDates(options.state);
  const currentDay = todayDayKey(now);

  const cells = DAY_KEYS.map((key, index) => {
    const date = addDays(weekBegan, index);
    const day = options.plan[key];
    const isSelected = key === options.selected;
    const isToday = key === currentDay;
    const isDone = done.has(toIsoDate(date));

    const label = [DAY_NAMES[key], day.label, isToday ? '(today)' : '', isDone ? '— session logged' : '']
      .filter(Boolean)
      .join(' ');

    return el(
      'button',
      {
        class: 'weekday',
        style: { '--pc': day.color },
        attrs: {
          type: 'button',
          'aria-label': label,
          'aria-current': isSelected ? 'date' : false,
          'data-today': isToday,
          'data-done': isDone,
        },
        on: { click: () => options.onSelect(key) },
      },
      [
        el('span', { class: 'weekday__name', text: DAY_NAMES[key] }),
        el('span', { class: 'weekday__dot', attrs: { 'aria-hidden': 'true' } }),
      ],
    );
  });

  replaceChildren(container, cells);
}
