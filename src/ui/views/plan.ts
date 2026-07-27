import type { Child } from '../dom';
import type { WeightUnit } from '@/types';
import { DAY_NAMES, PLAN, PLAN_ORDER } from '@/data/plan';
import { PLATE_LEGEND } from '@/data/plates';
import { todayIso } from '@/domain/dates';
import { UNIT_LABEL } from '@/domain/units';
import { parseStateJson, serializeState } from '@/state/schema';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderLegend } from '../components/charts';
import type { ViewContext } from './context';

/** The Plan tab: the rotation, settings, and data management. */
export function renderPlanView(context: ViewContext): Child[] {
  return [
    div('spine', [eyebrow('Seven-day rotation'), el('h1', { text: 'The plan' })]),
    renderRotation(context),
    renderSettings(context),
    renderColourKey(),
    renderDataCard(context),
    renderSafetyCard(),
  ];
}

function renderRotation(context: ViewContext): HTMLElement {
  return card(
    PLAN_ORDER.map((key) => {
      const day = PLAN[key];
      return div('logrow', [
        div('logrow__main', [
          el('div', {
            class: 'logrow__bar',
            style: { background: day.color },
            attrs: { 'aria-hidden': 'true' },
          }),
          div('', [text('logrow__title', `${DAY_NAMES[key]} — ${day.label}`), text('logrow__sub', day.sub)]),
        ]),
        el('button', {
          class: 'logrow__action',
          text: 'Open',
          attrs: { type: 'button', 'aria-label': `Open ${day.label}` },
          on: {
            click: () => {
              context.ui.viewDay = key;
              context.ui.tab = 'today';
              context.ui.exerciseIndex = 0;
              context.render();
            },
          },
        }),
      ]);
    }),
    'card--flush',
  );
}

/* --------------------------------------------------------------- settings */

function renderSettings(context: ViewContext): HTMLElement {
  const { prefs } = context.state;

  const unitButtons = (['lb', 'kg'] as const).map((unit: WeightUnit) =>
    el('button', {
      class: 'choices__button',
      text: UNIT_LABEL[unit],
      attrs: { type: 'button', 'aria-pressed': prefs.unit === unit },
      on: {
        click: () => {
          context.store.setUnit(unit);
          context.render();
        },
      },
    }),
  );

  return card([
    eyebrow('Settings'),

    div('setting', [
      div('setting__text', [
        text('setting__label', 'Weight unit'),
        text(
          'setting__hint',
          'Applies to entry, totals and charts. Sets you already logged keep the unit they were recorded in and are converted for display.',
        ),
      ]),
      el(
        'div',
        { class: 'choices__row', attrs: { role: 'group', 'aria-label': 'Weight unit' } },
        unitButtons,
      ),
    ]),

    div('setting', [
      div('setting__text', [
        text('setting__label', 'Vibrate when rest ends'),
        text('setting__hint', 'Where the device supports it.'),
      ]),
      el('div', { class: 'choices__row' }, [
        el('button', {
          class: 'choices__button',
          text: prefs.restVibrate ? 'On' : 'Off',
          attrs: { type: 'button', 'aria-pressed': prefs.restVibrate },
          on: {
            click: () => {
              context.store.setRestVibrate(!prefs.restVibrate);
              context.render();
            },
          },
        }),
      ]),
    ]),
  ]);
}

function renderColourKey(): HTMLElement {
  return card([
    eyebrow('Colour key'),
    text(
      'prose',
      'Each day carries the colour of the Olympic plate that matches its load. Red is the heaviest day, white the lightest.',
    ),
    renderLegend(PLATE_LEGEND.map((entry) => [entry.color, entry.label] as const)),
  ]);
}

/* ------------------------------------------------------------------- data */

function renderDataCard(context: ViewContext): HTMLElement {
  const fileInput = el('input', {
    class: 'visually-hidden',
    attrs: { type: 'file', accept: 'application/json,.json', tabindex: '-1' },
    on: { change: (event) => void handleImport(event, context) },
  });

  return card([
    eyebrow('Your data'),
    text(
      'prose',
      'Everything is stored on this device only. Nothing is sent anywhere. Clearing your browser data will erase it — export a backup now and then.',
    ),

    el('button', {
      class: 'button button--ghost',
      text: 'Export backup',
      attrs: { type: 'button' },
      on: { click: () => exportBackup(context) },
    }),

    el('button', {
      class: 'button button--ghost',
      text: 'Import backup',
      attrs: { type: 'button' },
      on: { click: () => fileInput.click() },
    }),
    fileInput,

    el('button', {
      class: 'button button--ghost button--danger',
      text: 'Erase all data',
      attrs: { type: 'button' },
      on: { click: () => eraseAll(context) },
    }),
  ]);
}

function exportBackup(context: ViewContext): void {
  const blob = new Blob([serializeState(context.state, true)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { attrs: { href: url, download: `rackfile-${todayIso()}.json` } });

  link.click();
  // Revoking immediately can cancel the download in some browsers; a short
  // delay is the conventional workaround.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup exported');
}

async function handleImport(event: Event, context: ViewContext): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so re-selecting the same file fires `change` again.
  input.value = '';
  if (!file) return;

  let raw: string;
  try {
    raw = await file.text();
  } catch {
    toast('Could not read that file');
    return;
  }

  const parsed = parseStateJson(raw);
  if (!parsed.recognised) {
    toast('That file is not a Rack & File backup');
    return;
  }

  const incoming = parsed.state.sessions.length;
  const existing = context.state.sessions.length;
  const warning =
    existing > 0
      ? `Replace your ${existing} logged session${existing === 1 ? '' : 's'} with ${incoming} from this backup? This cannot be undone.`
      : `Restore ${incoming} session${incoming === 1 ? '' : 's'} from this backup?`;

  if (!confirm(warning)) return;

  context.store.replaceState(parsed.state);
  toast(
    parsed.dropped > 0
      ? `Restored ${incoming} sessions · ${parsed.dropped} unreadable entries skipped`
      : `Restored ${incoming} sessions`,
  );
  context.render();
}

function eraseAll(context: ViewContext): void {
  const count = context.state.sessions.length;
  if (count === 0) {
    toast('Nothing to erase');
    return;
  }
  if (
    !confirm(`Permanently erase all ${count} logged sessions? Export a backup first if you might want them.`)
  ) {
    return;
  }
  if (!confirm('Last chance — this cannot be undone. Erase everything?')) return;

  context.store.replaceState({
    schemaVersion: context.state.schemaVersion,
    sessions: [],
    active: null,
    prefs: context.state.prefs,
  });
  toast('All data erased');
  context.render();
}

function renderSafetyCard(): HTMLElement {
  return card([
    eyebrow('Before you push'),
    text(
      'prose',
      'This is a training log, not medical advice. Stop the session if you get chest pain, dizziness, or shortness of breath that feels out of proportion to the effort. Talk to your doctor before ramping up, and again if anything unusual keeps happening.',
    ),
  ]);
}
