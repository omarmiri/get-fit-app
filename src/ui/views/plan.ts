import type { Child } from '../dom';
import type { FitnessLevel, WeightUnit } from '@/types';
import { DAY_NAMES, PLAN_ORDER } from '@/data/plan';
import { ALL_STATIONS } from '@/data/equipment';
import { daysBetween, todayIso } from '@/domain/dates';
import { UNIT_LABEL, formatWeight } from '@/domain/units';
import { parseStateJson, serializeState } from '@/state/schema';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import { renderAccountCard } from '../components/accountCard';
import { renderOnboarding } from '../components/onboarding';
import { renderPendingPlan } from '../components/planImport';
import { renderPlanWizard } from '../components/planWizard';
import { renderPlanLibrary } from '../components/planLibrary';
import type { PlanRoute, ViewContext } from './context';

/**
 * The Plan tab.
 *
 * Three tabs is the right split — do it, look at it, change it — and this is
 * the third one. The problem was that "Plan" meant thirteen cards in one
 * scroll: rotation, gym setup, equipment, plan library, choose-again, plan
 * inputs, plan import, profile, settings, colour key, data, account, safety.
 * Seven screens deep, no headings above card level, and no way to tell which
 * of those cards you were supposed to touch today.
 *
 * It is a five-row menu now. Four of the rows are destinations you can name
 * before you tap them; one is a task, and only that one is a wizard — because
 * writing a plan is the thing here with a real sequence and a real failure
 * mode. A settings screen you have to walk through is worse than one you have
 * to scroll.
 *
 * "Change how you train" is gone: it was a second door into the same room as
 * "Write me a new week". The colour key is gone too — a legend for a
 * decoration, when every day already says `25 KG PLATE` on its own screen. It
 * is one line in This week.
 */
export function renderPlanView(context: ViewContext): Child[] {
  // A plan that just arrived goes above whatever screen this is — see
  // `renderPendingPlan` for why it is not left inside the wizard.
  return [renderPendingPlan(context), ...renderPlanRoute(context)];
}

function renderPlanRoute(context: ViewContext): Child[] {
  switch (context.ui.planRoute) {
    case 'week':
      return renderRoute(context, 'This week', [renderRotation(context), renderPlateLine()]);
    case 'write':
      return renderRoute(context, 'Write me a new week', renderPlanWizard(context));
    case 'saved':
      return renderRoute(context, 'Saved plans', [renderPlanLibrary(context)]);
    case 'gym':
      return renderRoute(context, 'My gym', [renderEquipmentCard(context), renderUnitCard(context)]);
    case 'app':
      return renderRoute(context, 'App and data', [
        renderSettings(context),
        renderProfileCard(context),
        renderDataCard(context),
        renderAccountCard(context),
        renderSafetyCard(),
      ]);
    default:
      return renderMenu(context);
  }
}

/** Five rows. Four destinations and one task. */
function renderMenu(context: ViewContext): Child[] {
  const saved = context.state.plans?.length ?? 0;
  const strengthDays = PLAN_ORDER.filter((key) => context.plan[key].type === 'strength').length;

  const rows: readonly { route: PlanRoute; label: string; hint: string }[] = [
    {
      route: 'week',
      label: 'This week',
      hint: `Seven days, ${strengthDays} strength · edit or open a day`,
    },
    {
      route: 'write',
      label: 'Write me a new week',
      hint: 'Six questions, then your own chatbot',
    },
    {
      route: 'saved',
      label: 'Saved plans',
      hint: saved === 0 ? 'The built-in rotation only' : `${saved} kept · switch any time`,
    },
    { route: 'gym', label: 'My gym', hint: 'Equipment, missing machines, units' },
    { route: 'app', label: 'App and data', hint: 'Sound, backup, account' },
  ];

  return [
    div('spine', [eyebrow('Built-in rotation · in force'), el('h1', { text: 'Plan' })]),

    card(
      rows.map((row) =>
        el(
          'button',
          {
            class: 'menurow',
            attrs: { type: 'button' },
            on: {
              click: () => {
                context.ui.planRoute = row.route;
                context.ui.writeStep = 0;
                context.render();
              },
            },
          },
          [
            div('menurow__text', [text('menurow__label', row.label), text('menurow__hint', row.hint)]),
            el('span', { class: 'menurow__chevron', text: '›', attrs: { 'aria-hidden': 'true' } }),
          ],
        ),
      ),
      'card--flush',
    ),

    text('menufoot', 'Everything stays on this device. Nothing is sent anywhere unless you sign in.'),
  ];
}

/** A destination, with the way back out of it. */
function renderRoute(context: ViewContext, title: string, body: readonly Child[]): Child[] {
  return [
    el('button', {
      class: 'backlink',
      text: '‹ Plan',
      attrs: { type: 'button', 'aria-label': 'Back to the plan menu' },
      on: {
        click: () => {
          context.ui.planRoute = 'menu';
          context.render();
        },
      },
    }),
    div('spine', [el('h1', { text: title })]),
    ...body,
  ];
}

/**
 * The colour key, as one line rather than a card.
 *
 * A legend for a decoration is a sign the decoration is not carrying meaning —
 * and it does not need to, because every day states its load in text on its
 * own screen.
 */
function renderPlateLine(): HTMLElement {
  return text(
    'menufoot',
    'Each day carries the colour of the Olympic plate matching its load — red heaviest, white lightest.',
  );
}

/** Units live with the gym, because that is what decides which one you use. */
function renderUnitCard(context: ViewContext): HTMLElement {
  const { prefs } = context.state;

  return card([
    eyebrow('Units'),
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
        (['lb', 'kg'] as const).map((unit: WeightUnit) =>
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
        ),
      ),
    ]),
  ]);
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

  // The form itself, rather than a button that used to send you to a screen in
  // front of the first session.
  if (!profile) {
    return renderOnboarding({
      unit: context.state.prefs.unit,
      onSave: (saved) => {
        context.store.setProfile(saved);
        toast('Starting weights set — adjust any of them as you go');
        context.render();
      },
      onSkip: () => {
        context.store.setOnboarded(true);
        context.render();
      },
    });
  }

  const age = daysBetween(profile.recordedOn, todayIso());

  return card([
    eyebrow('Your details'),
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
      text: 'Clear these details',
      attrs: { type: 'button' },
      on: {
        click: () => {
          context.store.clearProfile();
          toast('Cleared — openings fall back to the default');
          context.render();
        },
      },
    }),
  ]);
}

/* --------------------------------------------------------------- settings */

function renderSettings(context: ViewContext): HTMLElement {
  const { prefs } = context.state;

  // The weight unit lives under My gym: it is a fact about where you train,
  // not an app preference, and it was previously the only thing standing
  // between someone and the switch they actually came here for.
  return card([
    eyebrow('Settings'),

    renderToggle(context, {
      label: 'Chime when rest ends',
      hint: 'Two short tones ten seconds out, one long at zero. Synthesised on the device, so there is nothing to download — and silent until you have tapped Start once, because a browser only lets audio begin from a tap.',
      on: prefs.restSound,
      onToggle: () => context.store.setRestSound(!prefs.restSound),
    }),

    renderToggle(context, {
      label: 'Say the next movement',
      hint: 'Reads out the movement and its weight when rest ends — "Chest press. Ninety-five, ten reps." Spoken on the device; nothing is sent anywhere.',
      on: prefs.spokenCues,
      onToggle: () => context.store.setSpokenCues(!prefs.spokenCues),
    }),

    renderToggle(context, {
      label: 'Vibrate when rest ends',
      hint: 'Where the device supports it. iOS does not, which is why the chime above is on by default.',
      on: prefs.restVibrate,
      onToggle: () => context.store.setRestVibrate(!prefs.restVibrate),
    }),
  ]);
}

/** A single on/off row. The settings screen is a list of switches, so it looks like one. */
function renderToggle(
  context: ViewContext,
  options: { label: string; hint: string; on: boolean; onToggle: () => void },
): HTMLElement {
  return div('setting', [
    div('setting__text', [text('setting__label', options.label), text('setting__hint', options.hint)]),
    el('div', { class: 'choices__row' }, [
      el('button', {
        class: 'choices__button',
        text: options.on ? 'On' : 'Off',
        attrs: { type: 'button', 'aria-pressed': options.on, 'aria-label': options.label },
        on: {
          click: () => {
            options.onToggle();
            context.render();
          },
        },
      }),
    ]),
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
    // Kept for the same reason as the plans: these are definitions, not history.
    customExercises: context.state.customExercises,
  });
  toast('All data erased');
  context.render();
}

/* -------------------------------------------------------------------- gym */

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
