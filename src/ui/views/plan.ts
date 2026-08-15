import type { Child } from '../dom';
import type { FitnessLevel, WeightUnit } from '@/types';
import { DAY_NAMES, PLAN_ORDER } from '@/data/plan';
import { ALL_STATIONS } from '@/data/equipment';
import { PLATE_LEGEND } from '@/data/plates';
import { daysBetween, todayIso } from '@/domain/dates';
import { UNIT_LABEL, formatWeight } from '@/domain/units';
import { parseStateJson, serializeState } from '@/state/schema';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderLegend } from '../components/charts';
import { renderPlanGenerator } from '../components/planGenerator';
import { renderPlanImport } from '../components/planImport';
import { renderPlanInputs } from '../components/planInputs';
import { renderPlanLibrary } from '../components/planLibrary';
import type { ViewContext } from './context';

/** The Plan tab: the rotation, settings, and data management. */
export function renderPlanView(context: ViewContext): Child[] {
  return [
    div('spine', [eyebrow('Seven-day rotation'), el('h1', { text: 'The plan' })]),
    renderRotation(context),
    renderGymCard(context),
    renderEquipmentCard(context),
    renderPlanLibrary(context),
    renderPlanInputs(() => {
      /*
       * Deliberately no re-render. These inputs feed the prompt and the
       * generator when they are next used; redrawing on every keystroke would
       * tear down the field being typed into and lose the caret.
       */
    }),
    renderPlanImport(context),
    renderPlanGenerator(context),
    renderProfileCard(context),
    renderSettings(context),
    renderColourKey(),
    renderDataCard(context),
    renderSafetyCard(),
  ];
}

function renderRotation(context: ViewContext): HTMLElement {
  return card(
    PLAN_ORDER.map((key) => {
      const day = context.plan[key];
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

/* ---------------------------------------------------------------- profile */

const LEVEL_LABEL: Readonly<Record<FitnessLevel, string>> = {
  new: 'New to this',
  returning: 'Returning',
  experienced: 'Experienced',
};

/**
 * The onboarding profile, and a way to redo it.
 *
 * Bodyweight drifts, and the starting estimates are only meaningful against a
 * current one — so the card shows how old the figure is rather than presenting
 * it as fact.
 */
function renderProfileCard(context: ViewContext): HTMLElement {
  const profile = context.state.prefs.profile;

  if (!profile) {
    return card([
      eyebrow('Your details'),
      text(
        'prose',
        'No profile set. The app opens every new movement at zero and you pick your own weights, which works fine — a profile just gives a safer first guess.',
      ),
      el('button', {
        class: 'button button--ghost',
        text: 'Set up starting weights',
        attrs: { type: 'button' },
        on: {
          click: () => {
            context.store.setOnboarded(false);
            context.ui.tab = 'today';
            context.render();
          },
        },
      }),
    ]);
  }

  const age = daysBetween(profile.recordedOn, todayIso());

  return card([
    eyebrow('Your details'),
    div('setting', [
      div('setting__text', [text('setting__label', 'Age'), text('setting__hint', `${profile.age} years`)]),
    ]),
    div('setting', [
      div('setting__text', [
        text('setting__label', 'Bodyweight'),
        text(
          'setting__hint',
          `${formatWeight(profile.bodyweight, profile.bodyweightUnit)}${age > 60 ? ` · recorded ${age} days ago` : ''}`,
        ),
      ]),
    ]),
    div('setting', [
      div('setting__text', [
        text('setting__label', 'Experience'),
        text('setting__hint', LEVEL_LABEL[profile.level]),
      ]),
    ]),
    text(
      'club__hint',
      'Used only to suggest an opening weight the first time you do a movement. Once there is a logged set, your own history takes over.',
    ),
    el('button', {
      class: 'button button--ghost',
      text: 'Update details',
      attrs: { type: 'button' },
      on: {
        click: () => {
          context.store.setOnboarded(false);
          context.ui.tab = 'today';
          context.render();
        },
      },
    }),
  ]);
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
    // Erasing training history does not throw away your saved plans.
    plans: context.state.plans,
    activePlanId: context.state.activePlanId,
    // The archive only exists to explain logged sets. With none left it
    // explains nothing, and the plan still defines whatever it defines.
    exerciseArchive: [],
  });
  toast('All data erased');
  context.render();
}

/* -------------------------------------------------------------------- gym */

/**
 * Where you train, in your own words.
 *
 * Free text rather than a structured venue picker, because the app does not
 * need to understand it — this is the paragraph that gets pasted into the
 * prompt you hand your LLM, and that reader parses English better than any
 * schema the app could impose. It is also the honest shape of the data: "the
 * squat racks are always busy after 5" is a real constraint on a plan and fits
 * nowhere in a list of checkboxes.
 */
function renderGymCard(context: ViewContext): HTMLElement {
  return card([
    eyebrow('Your gym'),
    text(
      'prose',
      'Describe where you train and what it has. This gets included when you copy a prompt for your LLM, so the plan it writes uses equipment you can actually reach.',
    ),
    el('textarea', {
      class: 'gen__input gen__input--area',
      // A textarea's initial value is its child text, not a `value` attribute.
      text: context.state.prefs.gym ?? '',
      attrs: {
        rows: 4,
        autocomplete: 'off',
        placeholder:
          'e.g. Big commercial gym. Full dumbbell rack to 100 lb, cables, most machines, squat rack and a pool. No sled or turf.',
        'aria-label': 'Describe your gym and its equipment',
      },
      on: {
        change: (event) => {
          context.store.setGym((event.target as HTMLTextAreaElement).value);
          toast('Gym details saved');
        },
      },
    }),
    text('club__hint', 'Stored on this device with everything else. Nothing is sent anywhere on its own.'),
  ]);
}

/**
 * The equipment vocabulary, and which of it your gym is missing.
 *
 * The app cannot know what is on your floor, so it assumes everything is
 * possible and lets you cross things off. That correction is the only
 * equipment fact the app actually holds, and it drives what the swap sheet
 * offers when a machine is taken.
 */
function renderEquipmentCard(context: ViewContext): HTMLElement {
  const missing = new Set(context.state.prefs.missingStations ?? []);

  return card([
    eyebrow('Equipment'),
    text(
      'prose',
      'These are the names the app knows for common gym equipment, used to suggest an alternative when your machine is taken. Tap anything your gym does not have and it stops being suggested.',
    ),

    div('club__group', [
      el(
        'div',
        { class: 'stationtags' },
        ALL_STATIONS.map((station) =>
          el('button', {
            class: missing.has(station.id) ? 'stationtag is-missing' : 'stationtag',
            text: station.name,
            attrs: {
              type: 'button',
              'aria-pressed': missing.has(station.id),
              'aria-label': missing.has(station.id)
                ? `${station.name} is marked as not at your gym. Tap to restore.`
                : `${station.name}. Tap to mark as not at your gym.`,
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
      text('club__hint', 'Tap again to bring something back.'),
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
