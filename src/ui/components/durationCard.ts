import type { Effort, PlanDay, Preferences, Session, Station } from '@/types';
import { ZONE_LABEL, getStation } from '@/data/equipment';
import { clampMinutes } from '@/domain/limits';
import { card, div, el, eyebrow, text } from '../dom';
import { type CardioTimerState, renderCardioTimer } from './cardioTimer';

/**
 * Minutes, modality and perceived effort for time-based sessions.
 *
 * The modality choices are real stations from the club rather than free text,
 * so a busy treadmill gets the same treatment as a busy bench: the alternatives
 * are already on screen, ranked, with a note on where to find each one.
 */

const EFFORTS: readonly Effort[] = ['Easy', 'Moderate', 'Hard'];

export interface DurationCardOptions {
  readonly day: PlanDay;
  /** The in-progress session, if one has been started. */
  readonly active: Session | null;
  readonly prefs: Preferences;
  /** Run clock state for this day, or null when it has not been started. */
  readonly cardio: CardioTimerState | null;
  readonly onCardioStart: () => void;
  readonly onCardioPause: () => void;
  readonly onCardioResume: () => void;
  readonly onCardioFinish: (elapsedMinutes: number) => void;
  readonly onCardioReset: () => void;
  readonly onMinutes: (minutes: number) => void;
  readonly onModality: (modality: string) => void;
  readonly onEffort: (effort: Effort) => void;
}

export function renderDurationCard(options: DurationCardOptions): HTMLElement {
  const { day, active } = options;
  const minutes = active?.minutes ?? day.minutes ?? 0;

  const minutesInput = el('input', {
    class: 'bigfield__input mono',
    attrs: {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': 'Session minutes',
      value: String(minutes),
    },
    on: {
      input: (event) => options.onMinutes(clampMinutes((event.target as HTMLInputElement).value)),
      blur: (event) => {
        const input = event.target as HTMLInputElement;
        input.value = String(clampMinutes(input.value));
      },
    },
  });

  return card([
    eyebrow(day.type === 'mixed' ? 'Cardio portion' : 'Session'),

    renderCardioTimer({
      targetMinutes: day.minutes ?? 30,
      state: options.cardio,
      shouldVibrate: options.prefs.restVibrate,
      onStart: options.onCardioStart,
      onPause: options.onCardioPause,
      onResume: options.onCardioResume,
      onFinish: options.onCardioFinish,
      onReset: options.onCardioReset,
    }),

    // The manual field stays. The clock is the convenient path, not the only
    // one — you may have run before opening the app, or reloaded mid-session.
    div('bigfield', [minutesInput, el('span', { class: 'bigfield__unit', text: 'minutes' })]),

    renderStationChoices(options),

    renderChoices('How hard did it feel', EFFORTS, active?.effort ?? null, (value) =>
      options.onEffort(value as Effort),
    ),

    renderMobility(day),
  ]);
}

/**
 * Cardio options as station cards, ordered so anything the user has marked
 * missing from their club sinks to the bottom rather than disappearing.
 */
function renderStationChoices(options: DurationCardOptions): HTMLElement | null {
  const ids = options.day.modalityStations;
  if (!ids || ids.length === 0) return null;

  const missing = new Set(options.prefs.missingStations ?? []);
  const stations = ids
    .map(getStation)
    .filter((s): s is Station => s !== undefined)
    .sort((a, b) => Number(missing.has(a.id)) - Number(missing.has(b.id)));

  return div('choices', [
    eyebrow('Where'),
    text('choices__hint', 'Whatever is free. The first one listed is the usual pick for this day.'),
    el(
      'div',
      { class: 'stationgrid', attrs: { role: 'group', 'aria-label': 'Cardio station' } },
      stations.map((station, index) => {
        const selected = options.active?.modality === station.name;

        return el(
          'button',
          {
            class: missing.has(station.id) ? 'stationcard is-missing' : 'stationcard',
            attrs: {
              type: 'button',
              'aria-pressed': selected,
              'aria-label': `${station.name}, ${ZONE_LABEL[station.zone]}`,
            },
            on: { click: () => options.onModality(station.name) },
          },
          [
            div('stationcard__top', [
              el('span', { class: 'stationcard__name', text: station.name }),
              index === 0 ? el('span', { class: 'swap__tag', text: 'Usual' }) : null,
            ]),
            text('stationcard__zone', ZONE_LABEL[station.zone]),
            station.note ? text('stationcard__note', station.note) : null,
          ],
        );
      }),
    ),
  ]);
}

/** Mobility and cooldown suggestions, shown as plain guidance rather than inputs. */
function renderMobility(day: PlanDay): HTMLElement | null {
  const ids = day.mobilityStations;
  if (!ids || ids.length === 0) return null;

  const stations = ids.map(getStation).filter((s): s is Station => s !== undefined);
  if (stations.length === 0) return null;

  return div('choices', [
    eyebrow('Finish with'),
    el(
      'ul',
      { class: 'mobility' },
      stations.map((station) => {
        // Some stations are their own zone — "Stretch area" in the stretch
        // area — so showing both just repeats the word.
        const zone = ZONE_LABEL[station.zone];
        return el('li', { class: 'mobility__item' }, [
          el('span', { class: 'mobility__name', text: station.name }),
          zone === station.name ? null : el('span', { class: 'mobility__zone', text: zone }),
        ]);
      }),
    ),
  ]);
}

/**
 * A row of single-select toggle buttons.
 *
 * `aria-pressed` rather than a radio group: choosing the same option again
 * clears it, which radios cannot express.
 */
function renderChoices(
  label: string,
  choices: readonly string[],
  selected: string | null,
  onChoose: (value: string) => void,
): HTMLElement {
  return div('choices', [
    eyebrow(label),
    el(
      'div',
      { class: 'choices__row', attrs: { role: 'group', 'aria-label': label } },
      choices.map((choice) =>
        el('button', {
          class: 'choices__button',
          text: choice,
          attrs: { type: 'button', 'aria-pressed': choice === selected },
          on: { click: () => onChoose(choice) },
        }),
      ),
    ),
  ]);
}
