import type { GymProfile } from '@/domain/gymProfile';
import { EQUIPMENT, VENUES, describeGym } from '@/domain/gymProfile';
import type { Child } from '../dom';
import { addDays } from '@/domain/dates';
import { div, el, eyebrow, text } from '../dom';
import type { ViewContext } from '../views/context';

/**
 * The questions that make a generated plan worth having.
 *
 * ## Why questions and not a text box
 *
 * This was a blank field labelled "describe your gym". Blank fields stay
 * blank, so the prompt ended up telling the model to assume a commercial gym
 * and guess — and a plan built on a guess about your equipment is a plan you
 * cannot follow. An empty box is not a neutral default; it is a question the
 * user never realised they were being asked.
 *
 * ## What is asked, and why each one earns its place
 *
 * Every question here changes what a good plan looks like:
 *
 * - **Venue** sets the default equipment, so most people tick nothing.
 * - **Equipment** is the single biggest constraint on movement selection.
 * - **Outdoors** decides whether cardio can be a run or has to be a machine.
 * - **Days a week** is the one people get wrong on their own — a five-day
 *   split written for someone who trains twice is not a plan, it is a
 *   reproach.
 * - **Session length** decides how much fits in a day.
 *
 * Nothing is required. Every answer improves the plan and none of them gates
 * anything.
 */

const DAY_CHOICES = [2, 3, 4, 5, 6] as const;
const MINUTE_CHOICES = [30, 45, 60, 75] as const;

/**
 * Which part of the survey a step is asking for.
 *
 * The whole thing used to be one card, shown twice — on first run, in front of
 * the door, and again on the Plan tab in the same scroll as the switches. It
 * is one wizard now, in the one place it belongs: the front of "Write me a new
 * week", which is the only task here with a real sequence, a real finish line
 * and a real failure mode.
 */
export type GymStep = 'venue' | 'equipment' | 'habits';

export function renderGymStep(context: ViewContext, step: GymStep): Child[] {
  const profile = context.state.prefs.gymProfile ?? {};
  const equipment = new Set(profile.equipment ?? []);

  /**
   * Save answers and regenerate the prose.
   *
   * The generated sentences replace `gym` wholesale. That is the right call
   * while the questions are the source — but it does mean a hand-edit is
   * overwritten by a later answer, which is why the free-text box sits below
   * these questions rather than above them, and says what it is for.
   */
  const update = (next: GymProfile): void => {
    context.store.setGymProfile(next);
    context.render();
  };

  if (step === 'venue') {
    return [
      text(
        'prose',
        'Where you train decides which movements are even possible. Nothing here is required, and you can change it later.',
      ),
      div('gen__group', [
        div(
          'choices__wrap',
          VENUES.map((venue) =>
            el(
              'button',
              {
                class: profile.venue === venue.id ? 'optionbtn is-on' : 'optionbtn',
                attrs: { type: 'button', 'aria-pressed': profile.venue === venue.id },
                on: {
                  click: () => {
                    /*
                     * Picking a venue ticks its usual equipment. A starting point,
                     * never a claim — every box below stays editable, because your
                     * chain gym might not have a pool and mine might.
                     */
                    const already = profile.venue === venue.id;
                    update({
                      ...profile,
                      venue: venue.id,
                      equipment: already ? [...equipment] : [...venue.implies],
                    });
                  },
                },
              },
              [text('optionbtn__label', venue.label), text('optionbtn__hint', venue.hint)],
            ),
          ),
        ),
      ]),
      renderToggle('Can you run or walk outdoors from home?', profile.outdoors, (value) =>
        update({ ...profile, outdoors: value }),
      ),
    ];
  }

  if (step === 'equipment') {
    return [
      text('prose', 'Tick what you can use.'),
      text(
        'club__hint',
        'Pre-ticked from the venue you picked — a starting point, never a claim. Your chain gym might not have a pool and mine might.',
      ),
      div(
        'choices__wrap',
        EQUIPMENT.map((item) =>
          el('button', {
            class: equipment.has(item.id) ? 'optionbtn optionbtn--chip is-on' : 'optionbtn optionbtn--chip',
            text: item.label,
            attrs: { type: 'button', 'aria-pressed': equipment.has(item.id) },
            on: {
              click: () => {
                const next = new Set(equipment);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                update({ ...profile, equipment: [...next] });
              },
            },
          }),
        ),
      ),
    ];
  }

  return [
    renderObserved(context, profile, update),

    renderChoiceRow(
      'Days a week you can train',
      DAY_CHOICES,
      profile.daysPerWeek,
      (value) => update({ ...profile, daysPerWeek: value }),
      (value) => String(value),
    ),

    renderChoiceRow(
      'Minutes per session',
      MINUTE_CHOICES,
      profile.sessionMinutes,
      (value) => update({ ...profile, sessionMinutes: value }),
      (value) => `${value}`,
    ),

    renderLikes(context),
  ];
}

/**
 * What two weeks of logged sessions already say, offered back.
 *
 * Asking "days a week" and "minutes per session" on day one gets a guess.
 * Asking it after a fortnight of logged sessions is a question the app can
 * answer better than the user can, so it answers it and offers the figure
 * rather than making them recall it.
 */
function renderObserved(
  context: ViewContext,
  profile: GymProfile,
  update: (next: GymProfile) => void,
): HTMLElement | null {
  const observed = observedHabits(context);
  if (!observed) return null;

  const matches = profile.daysPerWeek === observed.days && profile.sessionMinutes === observed.minutes;

  return div('gen__group', [
    text(
      'club__hint',
      `Over the last two weeks you have trained ${observed.days} ${observed.days === 1 ? 'day' : 'days'} a week, ${observed.minutes} minutes a session.`,
    ),
    matches
      ? null
      : el('button', {
          class: 'button button--ghost',
          text: 'Write the next plan around that',
          attrs: { type: 'button' },
          on: {
            click: () => update({ ...profile, daysPerWeek: observed.days, sessionMinutes: observed.minutes }),
          },
        }),
  ]);
}

/** Sessions a week and minutes a session, over the last fortnight. */
function observedHabits(context: ViewContext): { days: number; minutes: number } | null {
  const since = addDays(new Date(), -14);
  const recent = context.state.sessions.filter((session) => new Date(session.date) >= since);
  if (recent.length < 2) return null;

  const dates = new Set(recent.map((session) => session.date));
  const durations = recent.map((session) => session.durationMinutes ?? session.minutes ?? 0).filter(Boolean);
  if (durations.length === 0) return null;

  return {
    days: Math.max(1, Math.round(dates.size / 2)),
    minutes: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  };
}

/**
 * The sentences that will actually be sent, at the moment they are sent.
 *
 * There used to be two textareas on first run — this one, and the answers it
 * is generated from — with a stated rule that editing one destroyed the other.
 * It is read-only now, shown on the step with the buttons that send it, where
 * it is a preview rather than a form field. Anyone who wants to edit it can
 * edit it in the chat window, which is where they are going anyway.
 */
export function renderPromptPreview(context: ViewContext): HTMLElement {
  const profile = context.state.prefs.gymProfile ?? {};
  const body = context.state.prefs.gym ?? describeGym(profile);

  return div('gen__group', [
    eyebrow('What your LLM will be told'),
    text('preview', body || 'Nothing yet — answer a question or two and it appears here.'),
  ]);
}

/**
 * Movements the user actually wants to do.
 *
 * Free text rather than a checklist, because the useful answers are the ones
 * no list would contain: "I want to work up to a pull-up", "kettlebell swings
 * and please no burpees", "I would rather row than run". A model can act on
 * every one of those. A set of checkboxes could not express any of them.
 *
 * Adherence is the whole game — the best-designed week is worthless if it is
 * full of movements someone dreads — so this is asked plainly rather than
 * inferred from what they log.
 */
function renderLikes(context: ViewContext): HTMLElement {
  return div('gen__group', [
    eyebrow('Movements you enjoy, or would rather avoid'),
    el('textarea', {
      class: 'gen__input gen__input--area',
      text: context.state.prefs.likes ?? '',
      attrs: {
        rows: 3,
        autocomplete: 'off',
        placeholder:
          'e.g. I like kettlebell swings and rowing, want to work up to a pull-up, and would rather not run',
        'aria-label': 'Movements you enjoy or want to avoid',
      },
      on: {
        change: (event) => {
          context.store.setLikes((event.target as HTMLTextAreaElement).value);
        },
      },
    }),
    text('club__hint', 'Included in the prompt. The plan you keep doing beats the plan that looks best.'),
  ]);
}

function renderToggle(
  label: string,
  value: boolean | undefined,
  onChange: (value: boolean) => void,
): HTMLElement {
  return div('gen__group', [
    eyebrow(label),
    div('choices__row', [
      el('button', {
        class: value === true ? 'choices__button is-on' : 'choices__button',
        text: 'Yes',
        attrs: { type: 'button', 'aria-pressed': value === true },
        on: { click: () => onChange(true) },
      }),
      el('button', {
        class: value === false ? 'choices__button is-on' : 'choices__button',
        text: 'No',
        attrs: { type: 'button', 'aria-pressed': value === false },
        on: { click: () => onChange(false) },
      }),
    ]),
  ]);
}

function renderChoiceRow<T extends number>(
  label: string,
  options: readonly T[],
  selected: number | undefined,
  onChange: (value: T) => void,
  format: (value: T) => string,
): HTMLElement {
  return div('gen__group', [
    eyebrow(label),
    div(
      'choices__row',
      options.map((option) =>
        el('button', {
          class: selected === option ? 'choices__button is-on' : 'choices__button',
          text: format(option),
          attrs: { type: 'button', 'aria-pressed': selected === option },
          on: { click: () => onChange(option) },
        }),
      ),
    ),
  ]);
}
