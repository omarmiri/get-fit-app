import type { Child } from '../dom';
import type { WeightUnit } from '@/types';
import { DAY_NAMES, PLAN, PLAN_ORDER } from '@/data/plan';
import { CLUB, daysSinceVerified } from '@/data/club';
import { ALL_STATIONS, ZONE_LABEL } from '@/data/equipment';
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
    renderClubCard(),
    renderEquipmentCard(context),
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

/* ------------------------------------------------------------------- club */

function renderClubCard(): HTMLElement {
  const age = daysSinceVerified();

  return card([
    eyebrow('Your club'),
    text('club__name', CLUB.name),
    text('club__line', CLUB.address),
    text('club__line', CLUB.phone),

    div(
      'club__hours',
      CLUB.hours.map((h) => text('club__hoursrow', `${h.days} · ${h.open} – ${h.close}`)),
    ),

    div('club__group', [
      eyebrow('Amenities'),
      el(
        'ul',
        { class: 'club__list' },
        CLUB.amenities.map((a) => el('li', { text: a })),
      ),
    ]),

    div('club__group', [
      eyebrow('Classes'),
      text('club__line', CLUB.classes.join(' · ')),
      text('club__hint', 'Times change week to week — check the LA Fitness app for the current schedule.'),
    ]),

    div('club__group', [eyebrow('Not at this club'), text('club__line', CLUB.notAvailable.join(' · '))]),

    text(
      'club__hint',
      `Club listing checked ${age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`}. Hours and classes change — treat this as a starting point.`,
    ),
  ]);
}

/**
 * Equipment the app believes is on the floor, split by how confident it is.
 *
 * The unconfirmed list is the honest part: LA Fitness publishes amenities but
 * not machine inventories, so those entries are the chain's usual lineup rather
 * than a verified fact. Marking one missing removes it from every suggestion.
 */
function renderEquipmentCard(context: ViewContext): HTMLElement {
  const missing = new Set(context.state.prefs.missingStations ?? []);
  const confirmed = ALL_STATIONS.filter((s) => s.confidence === 'club-confirmed');
  const assumed = ALL_STATIONS.filter((s) => s.confidence === 'chain-standard');

  return card([
    eyebrow('Equipment'),
    text(
      'prose',
      'Confirmed items come from the club’s published amenities. The rest is LA Fitness’s usual lineup and is not verified for this location — correct it as you go and the app stops suggesting what is not there.',
    ),

    div('club__group', [
      eyebrow(`Confirmed at this club (${confirmed.length})`),
      el(
        'ul',
        { class: 'club__list' },
        confirmed.map((s) => el('li', { text: `${s.name} — ${ZONE_LABEL[s.zone]}` })),
      ),
    ]),

    div('club__group', [
      eyebrow(`Assumed present (${assumed.length})`),
      el(
        'div',
        { class: 'stationtags' },
        assumed.map((station) =>
          el('button', {
            class: missing.has(station.id) ? 'stationtag is-missing' : 'stationtag',
            text: station.name,
            attrs: {
              type: 'button',
              'aria-pressed': missing.has(station.id),
              'aria-label': missing.has(station.id)
                ? `${station.name} is marked as not at your club. Tap to restore.`
                : `${station.name}. Tap to mark as not at your club.`,
            },
            on: {
              click: () => {
                const nowMissing = !missing.has(station.id);
                context.store.setStationMissing(station.id, nowMissing);
                toast(nowMissing ? `${station.name} hidden` : `${station.name} restored`);
                context.render();
              },
            },
          }),
        ),
      ),
      text('club__hint', 'Tap anything your club does not have. Tap again to bring it back.'),
    ]),

    missing.size > 0
      ? el('button', {
          class: 'button button--ghost',
          text: `Restore all ${missing.size} hidden`,
          attrs: { type: 'button' },
          on: {
            click: () => {
              for (const id of missing) context.store.setStationMissing(id, false);
              toast('All equipment restored');
              context.render();
            },
          },
        })
      : null,
  ]);
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
