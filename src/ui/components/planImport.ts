import type { UserPlan } from '@/types';
import { ALL_STATIONS, stationName } from '@/data/equipment';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { parsePortablePlan } from '@/domain/planFormat';
import { buildPrompt } from '@/spec/planSpec';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';
import { renderPlanCandidate } from './planCandidate';

/**
 * Bring in a plan written by whichever LLM the user prefers.
 *
 * Three steps, in the order someone actually performs them: copy a prompt,
 * take it to their chatbot, bring the answer back. The third step accepts
 * either a paste or a file, because "the answer" arrives differently depending
 * on whether they were at a desk or on a phone.
 *
 * Both routes work offline and neither involves any third party. An earlier
 * version also accepted a Google Drive share link, fetched through a server
 * proxy. It was dropped: using it meant setting a file containing the user's
 * health context, age and bodyweight to "anyone with the link", which is a
 * poor trade for saving a paste — and on Android, Drive already appears in the
 * system file picker, so the file route covers that case without any of it.
 *
 * Nothing is saved until the plan is explicitly accepted, and every plan —
 * pasted, opened from a file, or generated in-app — goes through the same
 * parser and the same validator. There is no trusted path.
 */

interface ImportState {
  pasted: string;
  candidate: UserPlan | null;
  validation: PlanValidation | null;
  error: string | null;
  /** Whether the paste box is showing, so the card stays compact until needed. */
  open: boolean;
}

const state: ImportState = {
  pasted: '',
  candidate: null,
  validation: null,
  error: null,
  open: false,
};

/** Reset between visits so a stale candidate is not offered on the next open. */
export function resetPlanImport(): void {
  state.pasted = '';
  state.candidate = null;
  state.validation = null;
  state.error = null;
  state.open = false;
}

export function renderPlanImport(context: ViewContext): HTMLElement {
  return card([
    eyebrow('Bring a plan from any LLM'),
    text(
      'prose',
      'Copy a prompt, paste it into ChatGPT, Claude, Gemini or anything else, then bring the answer back here. The prompt carries the full format and your own details, so any model can write a week this app understands.',
    ),

    el('button', {
      class: 'button button--primary',
      text: 'Copy prompt for your LLM',
      attrs: { type: 'button' },
      on: { click: () => void copyPrompt(context) },
    }),

    div('gen__group', [
      el('button', {
        class: 'button button--ghost',
        text: state.open ? 'Hide the paste box' : 'Paste a plan',
        attrs: { type: 'button', 'aria-expanded': state.open },
        on: {
          click: () => {
            state.open = !state.open;
            context.render();
          },
        },
      }),

      renderFileButton(context),
    ]),

    state.open ? renderPasteBox(context) : null,

    state.error ? div('notice notice--warn', [text('notice__body', state.error)]) : null,

    state.candidate && state.validation
      ? renderPlanCandidate({
          plan: state.candidate,
          validation: state.validation,
          onAccept: () => {
            if (!state.candidate) return;
            context.store.setPlan(state.candidate);
            resetPlanImport();
            toast('Plan updated');
            context.render();
          },
          onDiscard: () => {
            state.candidate = null;
            state.validation = null;
            context.render();
          },
        })
      : null,
  ]);
}

function renderPasteBox(context: ViewContext): HTMLElement {
  return div('gen__group', [
    el('textarea', {
      class: 'gen__input gen__input--area gen__input--code',
      text: state.pasted,
      attrs: {
        rows: 6,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        placeholder: 'Paste the whole reply here — the code fence and any surrounding text are fine.',
        'aria-label': 'Paste a plan from your LLM',
      },
      on: {
        input: (event) => {
          state.pasted = (event.target as HTMLTextAreaElement).value;
        },
      },
    }),

    el('button', {
      class: 'button button--primary',
      text: 'Check this plan',
      attrs: { type: 'button' },
      on: { click: () => review(context, state.pasted) },
    }),
  ]);
}

/**
 * Open a plan saved to the device.
 *
 * Covers the phone case, and Google Drive along with it — on Android, Drive
 * mounts in the system file picker, so a plan saved there is reachable here
 * without this app touching a Google API or asking for an account.
 */
function renderFileButton(context: ViewContext): HTMLElement {
  const input = el('input', {
    class: 'visually-hidden',
    attrs: {
      type: 'file',
      accept: 'application/json,text/plain,text/markdown,.json,.txt,.md',
      tabindex: '-1',
    },
    on: {
      change: (event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;

        void file
          .text()
          .then((contents) => review(context, contents))
          .catch(() => {
            state.error = 'That file could not be read.';
            context.render();
          })
          // Cleared so choosing the same file twice fires `change` again.
          .finally(() => {
            target.value = '';
          });
      },
    },
  });

  return div('', [
    el('button', {
      class: 'button button--ghost',
      text: 'Open a plan file',
      attrs: { type: 'button' },
      on: { click: () => input.click() },
    }),
    input,
  ]);
}

/**
 * Parse, validate, and show what was found — without saving anything.
 *
 * The two failure modes are reported differently on purpose. A parse failure
 * means the text was not a plan at all, and the message says what to do about
 * it. A validation failure means it *was* a plan and something is wrong with
 * it, which is worth showing in full: the user can see the proposed week, the
 * problems, and decide whether to go back to their LLM.
 */
function review(context: ViewContext, input: string): void {
  const { plan, error } = parsePortablePlan(input);

  if (!plan) {
    state.candidate = null;
    state.validation = null;
    state.error = error ?? 'That plan could not be read.';
    context.render();
    return;
  }

  const missing = context.state.prefs.missingStations ?? [];
  const validation = validatePlan(plan, { missingStationIds: missing });

  state.candidate = plan;
  state.validation = validation;
  state.error = validation.ok
    ? null
    : 'That plan has problems the app cannot work with. The details are below — ask your LLM to fix them and paste the new version.';

  context.render();
}

async function copyPrompt(context: ViewContext): Promise<void> {
  const prefs = context.state.prefs;
  const profile = prefs.profile;
  const missing = new Set(prefs.missingStations ?? []);

  const prompt = buildPrompt(
    {
      ...(prefs.gym ? { gym: prefs.gym } : {}),
      ...(profile
        ? {
            age: profile.age,
            bodyweight: profile.bodyweight,
            bodyweightUnit: profile.bodyweightUnit,
            level: profile.level,
          }
        : {}),
      ...(prefs.conditions?.length ? { conditions: prefs.conditions } : {}),
      // Only what they have actually crossed off. Listing all forty stations
      // as "available" would be a claim the app cannot support.
      ...(missing.size > 0
        ? { missingEquipment: ALL_STATIONS.filter((s) => missing.has(s.id)).map((s) => stationName(s.id)) }
        : {}),
    },
    location.origin,
  );

  try {
    await navigator.clipboard.writeText(prompt);
    toast(prefs.gym ? 'Prompt copied — paste it to your LLM' : 'Prompt copied. Tip: describe your gym above');
  } catch {
    /*
     * Clipboard access can be refused outright — no permission, or an insecure
     * context. Falling back to a selected textarea means the user can still
     * copy it by hand rather than being told the feature is unavailable.
     */
    state.error = 'Could not reach the clipboard. The prompt is in the box below — select it and copy.';
    state.pasted = prompt;
    state.open = true;
    context.render();
  }
}
