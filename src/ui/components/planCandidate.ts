import type { Exercise, UserPlan, UserPlanDay } from '@/types';
import type { PlanValidation } from '@/domain/planValidation';
import { DAY_NAMES, GOALS } from '@/data/plan';
import { resolveExercise } from '@/data/catalogue';
import { stationName } from '@/data/equipment';
import { isCustomExerciseId } from '@/domain/planFormat';
import { type CardioTopUp, topUpCardio } from '@/domain/cardioTopUp';
import { div, el, eyebrow, text } from '../dom';

/**
 * A proposed week, its check results, and the decision to keep it.
 *
 * Shared by the in-app generator and the importer, so a plan from Gemini and a
 * plan from someone's own chatbot are presented identically — same summary,
 * same warnings, same button. A plan that arrived from outside is not shown
 * with any less scrutiny, and a plan generated in-app is not shown with any
 * more authority.
 *
 * The rendering is deliberately complete rather than summarised. This is the
 * only screen between a language model's output and a week of the user's
 * training, so everything the validator noticed is visible before they commit.
 */

export interface PlanCandidateOptions {
  readonly plan: UserPlan;
  readonly validation: PlanValidation;
  readonly onAccept: () => void;
  /** Absent when the caller has its own way out, e.g. "generate another". */
  readonly onDiscard?: () => void;
  /** Replace the candidate with one topped up to the weekly cardio target. */
  readonly onTopUp?: (topUp: CardioTopUp) => void;
}

export function renderPlanCandidate(options: PlanCandidateOptions): HTMLElement {
  const { plan, validation } = options;
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning');

  return div('gen__candidate', [
    eyebrow('Proposed week'),
    plan.summary ? text('prose', plan.summary) : null,

    text('gen__stats', describeStats(validation)),

    el(
      'ul',
      { class: 'gen__days' },
      plan.days.map((day) => renderDay(plan, day)),
    ),

    renderCustomExercises(plan),
    renderIssues('error', errors),
    renderIssues('warning', warnings),
    options.onTopUp ? renderTopUp(plan, options.onTopUp) : null,

    validation.ok
      ? el('button', {
          class: 'button button--primary',
          text: 'Use this plan',
          attrs: { type: 'button' },
          on: { click: options.onAccept },
        })
      : null,

    options.onDiscard
      ? el('button', {
          class: 'button button--ghost',
          text: 'Discard',
          attrs: { type: 'button' },
          on: { click: options.onDiscard },
        })
      : null,
  ]);
}

/**
 * The offer to add the missing cardio minutes, with exactly what it changes.
 *
 * Shown under the warning it answers. Listing the changes before the tap is
 * the point: this edits a plan someone else wrote, and the user should see
 * which days grow before they agree to it.
 */
function renderTopUp(plan: UserPlan, onTopUp: (topUp: CardioTopUp) => void): HTMLElement | null {
  const topUp = topUpCardio(plan);
  if (!topUp) return null;

  return div('gen__issues', [
    eyebrow(`Reach ${GOALS.minutes} cardio minutes`),
    el(
      'ul',
      {},
      topUp.changes.map((change) => el('li', { text: change })),
    ),
    el('button', {
      class: 'button button--ghost',
      text: `Add ${topUp.added} minutes of cardio`,
      attrs: { type: 'button' },
      on: { click: () => onTopUp(topUp) },
    }),
  ]);
}

/**
 * Days opened for a closer look, so a re-render — a sync landing, the top-up
 * button — does not snap them shut under the reader.
 */
const openDays = new Set<string>();

/**
 * One day of the proposed week: the headline, and on tap what it actually asks
 * for — the steps, the minutes, and each movement with its sets and what it is.
 *
 * The one-line summary was all the review used to show, which asked people to
 * accept a week of training on the strength of its labels. Rest days have
 * nothing to open.
 */
function renderDay(plan: UserPlan, day: UserPlanDay): HTMLElement {
  const headline = [
    el('span', { class: 'gen__daykey', text: DAY_NAMES[day.dayKey] }),
    div('gen__dayhead', [
      text('gen__daylabel', day.label),
      text('gen__daysub', day.sub || describeDay(day.type, day.minutes)),
    ]),
  ];

  if (day.type === 'rest') return el('li', { class: 'gen__day' }, [div('gen__summary', headline)]);

  const key = `${plan.id}:${day.dayKey}`;
  return el('li', { class: 'gen__day' }, [
    el(
      'details',
      {
        class: 'gen__detail',
        attrs: { open: openDays.has(key) },
        on: {
          toggle: (event) => {
            if ((event.target as HTMLDetailsElement).open) openDays.add(key);
            else openDays.delete(key);
          },
        },
      },
      [
        el('summary', { class: 'gen__summary' }, [
          ...headline,
          el('span', { class: 'gen__chevron', text: '▾', attrs: { 'aria-hidden': 'true' } }),
        ]),
        renderBreakdown(plan, day),
      ],
    ),
  ]);
}

function renderBreakdown(plan: UserPlan, day: UserPlanDay): HTMLElement {
  const where = day.modality ?? (day.modalityStations ?? []).map(stationName).join(', ');
  const movements = (day.exerciseIds ?? [])
    .map((id) => resolveExercise(id, { plan }))
    .filter((exercise): exercise is Exercise => exercise !== undefined);

  return div('gen__breakdown', [
    day.outline.length > 0
      ? el(
          'ol',
          { class: 'gen__steps' },
          day.outline.map((step) => el('li', { text: step })),
        )
      : null,

    day.minutes ? text('gen__cardio', `${day.minutes} min${where ? ` · ${where}` : ''}`) : null,

    movements.length > 0
      ? el(
          'ul',
          { class: 'gen__moves' },
          movements.map((exercise) => renderMovement(exercise)),
        )
      : null,

    day.note ? text('gen__daysub', day.note) : null,
  ]);
}

function renderMovement(exercise: Exercise): HTMLElement {
  const unit = exercise.repMetric === 'seconds' ? ' sec' : '';
  const range = exercise.repRange.replace(/ sec$/, '');
  const equipment =
    exercise.equipment ??
    (exercise.stations ?? [])
      .slice(0, 2)
      .map((station) => stationName(station.stationId))
      .join(' or ');

  return el('li', { class: 'gen__move' }, [
    div('gen__movehead', [
      el('span', { class: 'gen__movename', text: exercise.name }),
      isCustomExerciseId(exercise.id) ? el('span', { class: 'swap__tag', text: 'New' }) : null,
      el('span', { class: 'gen__movesets', text: `${exercise.sets} × ${range}${unit}` }),
    ]),
    exercise.summary ? text('gen__daysub', exercise.summary) : null,
    equipment ? text('gen__daysub', equipment) : null,
  ]);
}

function describeStats(validation: PlanValidation): string {
  const parts = [
    `${validation.weeklyAerobicMinutes} aerobic minutes`,
    `${validation.strengthDays} strength ${validation.strengthDays === 1 ? 'day' : 'days'}`,
  ];

  if (validation.customExercises > 0) {
    parts.push(
      `${validation.customExercises} new ${validation.customExercises === 1 ? 'movement' : 'movements'}`,
    );
  }

  return parts.join(' · ');
}

function describeDay(type: string, minutes: number | undefined): string {
  if (type === 'rest') return 'Rest';
  return minutes ? `${type} · ${minutes} min` : type;
}

/**
 * Movements this plan invented, listed by name.
 *
 * Worth its own section because it is the one thing an imported plan can do
 * that the built-in catalogue cannot, and the one the user should look at
 * hardest. A movement the app has never heard of comes with no substitutions
 * and no history — the plan's author is the only source for whether it is a
 * sensible thing to do.
 */
function renderCustomExercises(plan: UserPlan): HTMLElement | null {
  const custom = plan.exercises ?? [];
  if (custom.length === 0) return null;

  return div('gen__issues', [
    eyebrow(`${custom.length} movement${custom.length === 1 ? '' : 's'} this plan defines`),
    el(
      'ul',
      {},
      custom.map((exercise) =>
        el('li', {}, [
          el('span', { class: 'gen__daylabel', text: exercise.name }),
          exercise.equipment ? text('gen__daysub', exercise.equipment) : null,
        ]),
      ),
    ),
    text(
      'club__hint',
      'These come from the plan, not from the app — so they have no machine alternatives and no starting weight of their own beyond what the plan suggested.',
    ),
  ]);
}

function renderIssues(
  severity: 'error' | 'warning',
  issues: readonly { readonly message: string }[],
): HTMLElement | null {
  if (issues.length === 0) return null;

  const label =
    severity === 'error'
      ? `${issues.length} blocking ${issues.length === 1 ? 'problem' : 'problems'}`
      : `${issues.length} ${issues.length === 1 ? 'note' : 'notes'}`;

  return div(severity === 'error' ? 'gen__issues gen__issues--error' : 'gen__issues', [
    eyebrow(label),
    el(
      'ul',
      {},
      issues.map((issue) => el('li', { text: issue.message })),
    ),
  ]);
}
