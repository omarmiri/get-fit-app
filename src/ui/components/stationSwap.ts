import type { Exercise, Preferences, WeightUnit } from '@/types';
import { ZONE_LABEL } from '@/data/equipment';
import { type ResolvedOption, loadBasisLabel, resolveOptions } from '@/domain/substitutions';
import { formatWeightValue } from '@/domain/units';
import { div, el, text } from '../dom';

/**
 * The "someone is on it" sheet.
 *
 * Opens from the exercise card when the planned station is occupied. Every row
 * answers the three questions you actually have standing in a busy gym: what
 * else trains this, where is it, and what weight do I start with.
 *
 * Rendered inline rather than as a modal dialog. A real `<dialog>` would trap
 * focus and dim the page, which is the wrong feel for a one-handed tap between
 * sets — and this way the set you are mid-way through stays visible.
 */

export interface StationSwapOptions {
  readonly exercise: Exercise;
  readonly prefs: Preferences;
  readonly unit: WeightUnit;
  /** Current stepper load, used as the basis for conversions. */
  readonly currentWeight: number | null;
  readonly selectedStationId: string | undefined;
  /** Chose a station. `suggestedWeight` is null when there was nothing to convert. */
  readonly onChoose: (stationId: string, suggestedWeight: number | null) => void;
  /** Marked a station present or missing at this gym. */
  readonly onToggleMissing: (stationId: string, missing: boolean) => void;
  readonly onClose: () => void;
}

export function renderStationSwap(options: StationSwapOptions): HTMLElement {
  const resolved = resolveOptions(options.exercise, options.prefs, options.currentWeight, options.unit);

  if (resolved.length === 0) {
    return div('swap', [
      text('swap__empty', 'No alternative stations are listed for this movement yet.'),
      closeButton(options.onClose),
    ]);
  }

  return el(
    'section',
    { class: 'swap', attrs: { 'aria-label': `Alternatives for ${options.exercise.name}` } },
    [
      div('swap__head', [
        text('eyebrow', 'Taken? Try instead'),
        el('button', {
          class: 'swap__close',
          text: '✕',
          attrs: { type: 'button', 'aria-label': 'Close alternatives' },
          on: { click: options.onClose },
        }),
      ]),

      el(
        'ul',
        { class: 'swap__list' },
        resolved.map((entry) => renderRow(entry, options)),
      ),

      text(
        'swap__disclaimer',
        'Suggested loads are a starting point, not an equivalent. Machines differ — take the first set easy and adjust.',
      ),
    ],
  );
}

function renderRow(entry: ResolvedOption, options: StationSwapOptions): HTMLElement {
  const { station, option } = entry;
  const selected = station.id === options.selectedStationId;
  const basis = loadBasisLabel(entry.loadBasis);

  const meta = ZONE_LABEL[station.zone];

  const load =
    entry.suggestedWeight === null
      ? null
      : `${formatWeightValue(entry.suggestedWeight, options.unit)} ${options.unit}${basis ? ` ${basis}` : ''}`;

  return el('li', { class: entry.missing ? 'swap__item is-missing' : 'swap__item' }, [
    el(
      'button',
      {
        class: 'swap__pick',
        attrs: {
          type: 'button',
          'aria-pressed': selected,
          'aria-label': `Use ${station.name}${load ? `, start at ${load}` : ''}`,
        },
        on: { click: () => options.onChoose(station.id, entry.suggestedWeight) },
      },
      [
        div('swap__main', [
          div('swap__title', [
            el('span', { class: 'swap__name', text: station.name }),
            entry.isPrimary ? el('span', { class: 'swap__tag', text: 'Planned' }) : null,
          ]),
          meta ? text('swap__meta', meta) : null,
          option.note ? text('swap__note', option.note) : null,
          station.note && !option.note ? text('swap__note', station.note) : null,
        ]),
        load ? text('swap__load mono', load) : null,
      ],
    ),

    el('button', {
      class: 'swap__flag',
      text: entry.missing ? 'Not here ✕' : 'Not here?',
      attrs: {
        type: 'button',
        'aria-pressed': entry.missing,
        'aria-label': entry.missing
          ? `${station.name} is marked as not at your gym. Undo.`
          : `Mark ${station.name} as not at your gym`,
      },
      on: { click: () => options.onToggleMissing(station.id, !entry.missing) },
    }),
  ]);
}

function closeButton(onClose: () => void): HTMLElement {
  return el('button', {
    class: 'button button--ghost',
    text: 'Close',
    attrs: { type: 'button' },
    on: { click: onClose },
  });
}
