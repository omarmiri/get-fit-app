import type { UserPlan } from '@/types';
import type { PlanValidation } from '@/domain/planValidation';
import { DAY_NAMES } from '@/data/plan';
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
      plan.days.map((day) =>
        el('li', { class: 'gen__day' }, [
          el('span', { class: 'gen__daykey', text: DAY_NAMES[day.dayKey] }),
          div('', [
            text('gen__daylabel', day.label),
            text('gen__daysub', day.sub || describeDay(day.type, day.minutes)),
          ]),
        ]),
      ),
    ),

    renderCustomExercises(plan),
    renderIssues('error', errors),
    renderIssues('warning', warnings),

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
