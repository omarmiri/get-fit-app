import type { UserPlan } from '@/types';
import { ALL_STATIONS } from '@/data/equipment';
import { describePlanSource } from '@/data/activePlan';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { PlanApiError, requestPlan } from '@/services/planApi';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';
import { renderPlanCandidate } from './planCandidate';

/**
 * Generate a week without leaving the app, then decide whether to keep it.
 *
 * The convenient path, for when the user does not want to go to a chatbot and
 * come back. It is not a privileged one: the response is parsed by the same
 * parser and checked by the same validator as a plan pasted in from anywhere
 * else, and presented by the same component. See `planImport.ts` for the
 * bring-your-own path.
 *
 * Nothing is saved until the plan is explicitly accepted, and the built-in plan
 * is always one tap away.
 */

interface GeneratorState {
  busy: boolean;
  candidate: UserPlan | null;
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
    eyebrow('Plan in force'),
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
      text(
        'club__hint',
        'Included both in the prompt you copy above and in a plan generated here, along with your age, bodyweight and gym.',
      ),
    ]),

    div('gen__group', [
      eyebrow('Anything to work around this week'),
      renderTextField(state.notes, 'e.g. sore left shoulder, travelling Thursday', (value) => {
        state.notes = value;
      }),
    ]),

    state.error ? div('notice notice--warn', [text('notice__body', state.error)]) : null,
    state.candidate && state.validation
      ? renderPlanCandidate({
          plan: state.candidate,
          validation: state.validation,
          onAccept: () => {
            if (!state.candidate) return;
            context.store.setPlan(state.candidate);
            resetPlanGenerator();
            toast('Plan updated');
            context.render();
          },
        })
      : null,

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
    // Equipment the user has not crossed off, so the model is not steered
    // toward a machine they have already said is not there.
    const missing = new Set(context.state.prefs.missingStations ?? []);
    const available = ALL_STATIONS.filter((s) => !missing.has(s.id)).map((s) => s.id);

    const plan = await requestPlan({
      ...(context.state.prefs.profile ? { profile: context.state.prefs.profile } : {}),
      conditions: context.state.prefs.conditions ?? [],
      notes: state.notes,
      availableStationIds: available,
      ...(context.state.prefs.gym ? { gym: context.state.prefs.gym } : {}),
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
