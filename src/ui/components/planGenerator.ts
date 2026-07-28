import type { GeneratedPlan } from '@/types';
import { ALL_STATIONS } from '@/data/equipment';
import { describePlanSource } from '@/data/activePlan';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { PlanApiError, requestPlan } from '@/services/planApi';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';

/**
 * Generate a week with Gemini, check it, then decide whether to keep it.
 *
 * The model chooses movements and structure by referencing catalogue ids; it
 * never invents an exercise and never prescribes a load. Everything it returns
 * goes through `validatePlan` before it can be adopted, so a plan that names a
 * movement the app does not have is rejected rather than half-rendered.
 *
 * Nothing is saved until the plan is explicitly accepted, and the built-in plan
 * is always one tap away.
 */

interface GeneratorState {
  busy: boolean;
  candidate: GeneratedPlan | null;
  validation: PlanValidation | null;
  error: string | null;
  notes: string;
}

const state: GeneratorState = {
  busy: false,
  candidate: null,
  validation: null,
  error: null,
  notes: '',
};

/** Reset between visits so a stale candidate is not offered on the next open. */
export function resetPlanGenerator(): void {
  state.candidate = null;
  state.validation = null;
  state.error = null;
  state.busy = false;
}

export function renderPlanGenerator(context: ViewContext): HTMLElement {
  const conditions = context.state.prefs.conditions ?? [];

  return card([
    eyebrow('Plan'),
    text('setting__label', describePlanSource(context.state.plan)),
    context.state.plan?.summary ? text('prose', context.state.plan.summary) : null,

    div('gen__group', [
      eyebrow('Health context'),
      renderTextField(conditions.join(', '), 'e.g. high cholesterol, high glucose', (value) => {
        context.store.setConditions(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }),
      text('club__hint', 'Sent to Gemini along with your age, bodyweight and available equipment.'),
    ]),

    div('gen__group', [
      eyebrow('Anything to work around this week'),
      renderTextField(state.notes, 'e.g. sore left shoulder, travelling Thursday', (value) => {
        state.notes = value;
      }),
    ]),

    state.error ? div('notice notice--warn', [text('notice__body', state.error)]) : null,
    state.candidate && state.validation ? renderCandidate(context, state.candidate, state.validation) : null,

    el('button', {
      class: 'button button--primary',
      text: state.busy ? 'Generating…' : state.candidate ? 'Generate another' : 'Generate a plan',
      attrs: { type: 'button', 'aria-busy': state.busy, disabled: state.busy },
      on: { click: () => void generate(context) },
    }),

    context.state.plan
      ? el('button', {
          class: 'button button--ghost',
          text: 'Back to the built-in plan',
          attrs: { type: 'button' },
          on: {
            click: () => {
              context.store.setPlan(null);
              resetPlanGenerator();
              toast('Reverted to the built-in plan');
              context.render();
            },
          },
        })
      : null,
  ]);
}

async function generate(context: ViewContext): Promise<void> {
  if (state.busy) return;

  state.busy = true;
  state.error = null;
  context.render();

  try {
    // Only equipment the club actually has, so the model cannot prescribe a
    // machine that is not there.
    const missing = new Set(context.state.prefs.missingStations ?? []);
    const available = ALL_STATIONS.filter((s) => !missing.has(s.id)).map((s) => s.id);

    const plan = await requestPlan({
      ...(context.state.prefs.profile ? { profile: context.state.prefs.profile } : {}),
      conditions: context.state.prefs.conditions ?? [],
      notes: state.notes,
      availableStationIds: available,
    });

    const validation = validatePlan(plan, { missingStationIds: [...missing] });

    state.candidate = plan;
    state.validation = validation;
    state.error = validation.ok ? null : 'That plan had problems the app cannot work with. Generate another.';
  } catch (error) {
    state.candidate = null;
    state.validation = null;
    state.error = error instanceof PlanApiError ? error.message : 'Plan generation failed. Try again.';
  } finally {
    state.busy = false;
    context.render();
  }
}

/** The proposed week, its check results, and the decision to keep it or not. */
function renderCandidate(context: ViewContext, plan: GeneratedPlan, validation: PlanValidation): HTMLElement {
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning');

  return div('gen__candidate', [
    eyebrow('Proposed week'),
    plan.summary ? text('prose', plan.summary) : null,

    text(
      'gen__stats',
      `${validation.weeklyAerobicMinutes} aerobic minutes · ${validation.strengthDays} strength ${validation.strengthDays === 1 ? 'day' : 'days'}`,
    ),

    el(
      'ul',
      { class: 'gen__days' },
      plan.days.map((day) =>
        el('li', { class: 'gen__day' }, [
          el('span', { class: 'gen__daykey', text: day.dayKey.toUpperCase() }),
          div('', [text('gen__daylabel', day.label), text('gen__daysub', day.sub || day.type)]),
        ]),
      ),
    ),

    ...(errors.length > 0
      ? [
          div('gen__issues gen__issues--error', [
            eyebrow(`${errors.length} blocking ${errors.length === 1 ? 'problem' : 'problems'}`),
            el(
              'ul',
              {},
              errors.map((issue) => el('li', { text: issue.message })),
            ),
          ]),
        ]
      : []),

    ...(warnings.length > 0
      ? [
          div('gen__issues', [
            eyebrow(`${warnings.length} ${warnings.length === 1 ? 'note' : 'notes'}`),
            el(
              'ul',
              {},
              warnings.map((issue) => el('li', { text: issue.message })),
            ),
          ]),
        ]
      : []),

    validation.ok
      ? el('button', {
          class: 'button button--primary',
          text: 'Use this plan',
          attrs: { type: 'button' },
          on: {
            click: () => {
              context.store.setPlan(plan);
              resetPlanGenerator();
              toast('Plan updated');
              context.render();
            },
          },
        })
      : null,
  ]);
}

function renderTextField(
  initial: string,
  placeholder: string,
  onChange: (value: string) => void,
): HTMLElement {
  return el('input', {
    class: 'gen__input',
    attrs: { type: 'text', autocomplete: 'off', placeholder, value: initial },
    on: { change: (event) => onChange((event.target as HTMLInputElement).value) },
  });
}
