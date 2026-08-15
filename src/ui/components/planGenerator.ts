import type { UserPlan } from '@/types';
import { ALL_STATIONS } from '@/data/equipment';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { PlanApiError, requestPlan } from '@/services/planApi';
import { conditionsList, getNotes } from '@/state/ephemeral';
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
}

const state: GeneratorState = {
  busy: false,
  candidate: null,
  validation: null,
  error: null,
};

/** Reset between visits so a stale candidate is not offered on the next open. */
export function resetPlanGenerator(): void {
  state.candidate = null;
  state.validation = null;
  state.error = null;
  state.busy = false;
}

export function renderPlanGenerator(context: ViewContext): HTMLElement {
  return card([
    // Which plan is in force, and switching between them, belongs to the
    // library card above. The health context and notes belong to the shared
    // inputs card. This card is only the act of making a new plan.
    eyebrow('Generate one here instead'),
    text(
      'prose',
      'Uses what you wrote above, plus the same format and the same checks as a plan from your own LLM, without leaving the app.',
    ),

    state.error ? div('notice notice--warn', [text('notice__body', state.error)]) : null,
    state.candidate && state.validation
      ? renderPlanCandidate({
          plan: state.candidate,
          validation: state.validation,
          onAccept: () => {
            if (!state.candidate) return;
            context.store.adoptPlan(state.candidate);
            resetPlanGenerator();
            toast('Saved to your plans and switched to it');
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
      conditions: conditionsList(),
      notes: getNotes(),
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
