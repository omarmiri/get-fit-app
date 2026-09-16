import type { UserPlan } from '@/types';
import { ALL_STATIONS, stationName } from '@/data/equipment';
import { LLM_PROVIDERS, fitsInLink } from '@/data/llmProviders';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { parsePortablePlan } from '@/domain/planFormat';
import { buildBriefPrompt, buildPrompt } from '@/spec/planSpec';
import { clearDrop, currentDrop, dropEndpoint, openDrop, pollDrop } from '@/services/planDrop';
import { conditionsList, getNotes } from '@/state/ephemeral';
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
  /** The push id currently in the copied prompt, if a session is open. */
  pushId: string | null;
  /** Highest version already seen, so an arrival is announced exactly once. */
  seenVersion: number;
}

const state: ImportState = {
  pasted: '',
  candidate: null,
  validation: null,
  error: null,
  open: false,
  pushId: currentDrop()?.pushId ?? null,
  seenVersion: 0,
};

/**
 * Watching for a pushed plan.
 *
 * Only runs while a card that shows the session is on screen, and stops the
 * moment one arrives — this is not a background sync, it is a screen waiting
 * for a specific thing to happen.
 */
let watcher: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 4000;

function stopWatching(): void {
  if (watcher !== null) {
    clearInterval(watcher);
    watcher = null;
  }
}

function startWatching(context: ViewContext): void {
  if (watcher !== null || !state.pushId) return;

  watcher = setInterval(() => {
    void (async () => {
      try {
        const plans = await pollDrop();
        const latest = plans.at(-1);
        if (!latest || latest.version <= state.seenVersion) return;

        state.seenVersion = latest.version;
        stopWatching();
        /*
         * A pushed plan goes through the same validator as a pasted one. The
         * server already parsed it — that is how it was stored — but it has no
         * opinion on whether the plan suits *this* device's equipment, which
         * is what `validatePlan` answers.
         */
        reviewPlan(context, latest.plan);
        toast(latest.version > 1 ? `Version ${latest.version} arrived` : 'Your plan arrived');
      } catch {
        // A failed poll is not worth surfacing: the next one is four seconds
        // away, and the paste box is right there either way.
      }
    })();
  }, POLL_MS);
}

/** Reset between visits so a stale candidate is not offered on the next open. */
export function resetPlanImport(): void {
  state.pasted = '';
  state.candidate = null;
  state.validation = null;
  state.error = null;
  state.open = false;
  stopWatching();
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

    renderLaunchers(context),

    /*
     * The short prompt, for anyone who has connected the MCP server.
     *
     * Offered rather than detected, because the app has no way to know what a
     * user has configured in someone else's chat client. Getting it wrong
     * costs a paste in one direction and a confused model in the other, so the
     * user says which they have and the wording makes the consequence clear.
     */
    el('button', {
      class: 'button button--ghost',
      text: 'Copy short prompt (connector)',
      attrs: { type: 'button', title: 'For clients with the Rack & File connector added' },
      on: { click: () => void copyPrompt(context, true) },
    }),

    div('gen__group', [
      /*
       * First, because it is the shortest path back: one tap where the box
       * below takes four. The box stays for the browsers that refuse to hand
       * over the clipboard, and for anyone who would rather see what they are
       * importing before it is read.
       */
      el('button', {
        class: 'button button--primary',
        text: 'Paste plan from clipboard',
        attrs: { type: 'button' },
        on: { click: () => void importFromClipboard(context) },
      }),

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

    state.pushId && !state.candidate ? renderWaiting(context) : null,

    state.open ? renderPasteBox(context) : null,

    state.error ? div('notice notice--warn', [text('notice__body', state.error)]) : null,

    state.candidate && state.validation
      ? renderPlanCandidate({
          plan: state.candidate,
          validation: state.validation,
          onAccept: () => {
            if (!state.candidate) return;
            context.store.adoptPlan(state.candidate);
            resetPlanImport();
            toast('Saved to your plans and switched to it');
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

/**
 * A plan arriving from the system share sheet.
 *
 * Android delivers a share to the manifest's `share_target` as a normal
 * navigation with the shared text in the query string, so this is read on load
 * in the same way, and at the same moment, as a sign-in redirect.
 *
 * The URL is cleaned whether or not the text turns out to be a plan. Leaving it
 * would mean a refresh re-importing something already dealt with, and a shared
 * plan sitting in the address bar, the back button and any link the user then
 * shares onwards — the same reasoning as the tokens in `account.ts`.
 *
 * Returns whether anything was found, so the caller can decide to re-render.
 */
export function captureSharedPlan(context: ViewContext): boolean {
  const params = new URLSearchParams(location.search);
  const shared = params.get('shared');
  if (!shared) return false;

  params.delete('shared');
  params.delete('shared_title');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);

  // The same parser as every other route in. A share that was not a plan gets
  // the parser's own explanation rather than a guess about what it might be.
  review(context, shared);
  return true;
}

/**
 * Ctrl-V anywhere in the app, and the plan is in.
 *
 * ## Why this exists alongside the clipboard button
 *
 * Reading the clipboard needs a permission the browser may refuse. Being
 * *given* the clipboard needs nothing at all: a paste event carries its own
 * data, in every browser, with no prompt, because the user pasting is the
 * consent. It is the only route in that cannot be denied.
 *
 * So this is not a fallback for the button — it is the more reliable of the
 * two, and it is free. On a phone it is a long-press and Paste on the page
 * itself; at a desk it is the keystroke the user was already reaching for.
 *
 * ## Why a failed parse says nothing
 *
 * Every other route in is an explicit request — a button pressed, a file
 * chosen — and an explicit request that fails deserves an explanation. This
 * one fires on every paste in the app, including pastes meant for something
 * else entirely, so it stays silent unless what arrived really was a plan.
 * A copied URL should not produce a complaint about plan format.
 *
 * Pastes into a field are left alone for the same reason: the paste box, the
 * gym description and the notes all want the text themselves.
 */
export function watchPastedPlans(getContext: () => ViewContext): void {
  document.addEventListener('paste', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;

    const pasted = event.clipboardData?.getData('text/plain') ?? '';
    if (!pasted.trim()) return;

    const { plan } = parsePortablePlan(pasted);
    if (!plan) return;

    event.preventDefault();

    const context = getContext();
    // The review card lives on the Plan tab, so a paste from anywhere else
    // has to bring the user to it — a candidate rendered on a screen nobody
    // is looking at is the same as no candidate.
    context.ui.tab = 'plan';
    reviewPlan(context, plan);
    toast('Plan found on the clipboard — review it below');

    // After the paint that `reviewPlan` asked for, not before it.
    requestAnimationFrame(() => {
      document.querySelector('.gen__candidate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

/**
 * What the app is waiting for, and what to do if it never comes.
 *
 * ## Why this screen carries the whole design
 *
 * Most chat products cannot make HTTP requests, and a model asked to POST from
 * one will sometimes say it did. If the app trusted that, the user would sit
 * looking at a spinner for a plan that was never sent. So the app never asks
 * the model whether it worked — it either received a push or it did not, and
 * this card says which, with the paste box one tap away the entire time.
 *
 * That is what makes it safe to ask for the push at all. The optimistic path
 * costs nothing when it fails, because the fallback was never hidden.
 */
function renderWaiting(context: ViewContext): HTMLElement {
  startWatching(context);

  return div('notice', [
    text('notice__body', `Waiting for your plan. The prompt you copied asks your LLM to send it here.`),

    // Shown because a model occasionally drops or mangles the id, and the user
    // can then read it off the screen and correct it themselves.
    div('gen__group', [
      text('prose', `Session ${state.pushId ?? ''}`),
      el('button', {
        class: 'button button--ghost',
        text: 'Start a new session',
        attrs: { type: 'button' },
        on: {
          click: () => {
            // Someone whose chat has gone wrong wants a clean id rather than a
            // diagnosis of what the last one did.
            clearDrop();
            stopWatching();
            state.pushId = null;
            state.seenVersion = 0;
            context.render();
          },
        },
      }),
    ]),

    text(
      'prose',
      'If your LLM says it cannot send HTTP requests — most chat apps cannot — paste its reply below instead. Nothing is lost either way.',
    ),
  ]);
}

/**
 * Open a chatbot with the prompt already in it.
 *
 * ## The window is opened before the work, not after
 *
 * `window.open` only survives a popup blocker while the browser still
 * considers itself inside the click that caused it, and awaiting anything
 * first ends that. Opening a blank tab synchronously and pointing it somewhere
 * once the session exists is the standard way round it — get that order wrong
 * and the feature works in Chrome and silently does nothing in Safari.
 *
 * `opener` is cleared before navigating, so the page that opens cannot reach
 * back into this one.
 */
async function launch(context: ViewContext, providerId: string): Promise<void> {
  const provider = LLM_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return;

  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;

  const prompt = await buildPromptText(context, true);

  /*
   * Copied as well as linked. These query parameters are not promised by
   * anyone and can stop working without notice; when that happens the user
   * lands on an empty chat box with the right text already on the clipboard
   * rather than on nothing at all.
   */
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    // Clipboard refused. The link is still the main path.
  }

  if (!prompt || !fitsInLink(provider, prompt)) {
    tab?.close();
    state.error = 'That prompt is too long to send by link. It is on your clipboard — paste it instead.';
    context.render();
    return;
  }

  if (tab) tab.location.href = provider.link(prompt);
  else window.location.assign(provider.link(prompt));

  context.render();
}

function renderLaunchers(context: ViewContext): HTMLElement {
  return div('gen__group', [
    text('prose', 'Or open one with the prompt already in it:'),
    ...LLM_PROVIDERS.map((provider) =>
      el('button', {
        class: 'button button--ghost',
        text: provider.name,
        attrs: { type: 'button' },
        on: { click: () => void launch(context, provider.id) },
      }),
    ),
  ]);
}

/**
 * Read a plan straight off the clipboard.
 *
 * ## Why this is a button and not automatic
 *
 * Reading the clipboard on focus would be the nicer trick and does not work.
 * `readText` needs a user gesture in Safari, prompts for a permission in
 * Chrome, and is not implemented for web pages in Firefox at all — so the
 * version that watches for focus is the version that silently does nothing for
 * a large share of people, with no way for them to tell why.
 *
 * A button is a gesture, which satisfies every one of those rules, and it
 * still collapses the old sequence — open the box, tap the box, paste, press
 * Check — into a single tap. That matters most on a phone, where a long-press
 * paste into a textarea is the fiddliest part of the whole flow.
 *
 * Failure falls back to the paste box rather than to an apology: the clipboard
 * may be denied, empty, or hold something else entirely, and in all three
 * cases the useful response is the same.
 */
async function importFromClipboard(context: ViewContext): Promise<void> {
  let pasted = '';
  try {
    pasted = await navigator.clipboard.readText();
  } catch {
    state.error = 'This browser would not let the app read the clipboard. Paste it into the box instead.';
    state.open = true;
    context.render();
    return;
  }

  if (!pasted.trim()) {
    state.error = "The clipboard is empty. Copy your LLM's reply first.";
    context.render();
    return;
  }

  /*
   * Handed to the same parser as everything else, which already tolerates the
   * surrounding prose and code fences an LLM reply arrives wrapped in — so
   * there is no need to guess here whether the clipboard "looks like" a plan.
   * If it is not one, the parser says so better than a heuristic could.
   */
  review(context, pasted);
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

  reviewPlan(context, plan);
}

/**
 * Everything a plan goes through once it is a plan, whichever way it arrived.
 *
 * Pushed and pasted plans meet here. A pushed one has already been through the
 * same parser on the server — that is how it was stored — but parsing answers
 * "is this a plan", and this answers "does it suit the gym this person
 * actually trains in", which is a question only the device can settle.
 */
function reviewPlan(context: ViewContext, plan: UserPlan): void {
  const missing = context.state.prefs.missingStations ?? [];
  const validation = validatePlan(plan, { missingStationIds: missing });

  state.candidate = plan;
  state.validation = validation;
  state.error = validation.ok
    ? null
    : 'That plan has problems the app cannot work with. The details are below — ask your LLM to fix them and send the new version.';

  context.render();
}

/**
 * Open a session and build the prompt that names it.
 *
 * Shared by the copy buttons and the launcher links, so that whichever route
 * someone takes, the app is watching the same session the prompt mentions.
 *
 * Opening the session is best-effort. If it fails — offline, or the server is
 * down — the full prompt is still built and still works; it simply asks for
 * the JSON without offering anywhere to post it. Refusing to produce a prompt
 * because a convenience could not be arranged would be the wrong trade.
 */
async function buildPromptText(context: ViewContext, brief = false): Promise<string> {
  const prefs = context.state.prefs;
  const profile = prefs.profile;
  const missing = new Set(prefs.missingStations ?? []);

  let drop: { pushId: string; endpoint: string } | undefined;
  try {
    const session = await openDrop();
    drop = { pushId: session.pushId, endpoint: dropEndpoint(session.pushId) };
    state.pushId = session.pushId;
  } catch {
    state.pushId = null;
  }

  const person = {
    ...(prefs.gym ? { gym: prefs.gym } : {}),
    ...(prefs.likes ? { likes: prefs.likes } : {}),
    ...(profile
      ? {
          age: profile.age,
          bodyweight: profile.bodyweight,
          bodyweightUnit: profile.bodyweightUnit,
          level: profile.level,
        }
      : {}),
    // Read from ephemeral state, not preferences — health context is typed
    // per plan and never stored. See `state/ephemeral.ts`.
    ...(conditionsList().length > 0 ? { conditions: conditionsList() } : {}),
    ...(getNotes() ? { notes: getNotes() } : {}),
    // Only what they have actually crossed off. Listing all forty stations
    // as "available" would be a claim the app cannot support.
    ...(missing.size > 0
      ? { missingEquipment: ALL_STATIONS.filter((s) => missing.has(s.id)).map((s) => stationName(s.id)) }
      : {}),
  };

  /*
   * The brief prompt is only honest if there is a session to name in it. With
   * no drop open the tools have nothing to submit to, so fall back to the full
   * prompt rather than handing someone an id-shaped hole.
   */
  return brief && drop
    ? buildBriefPrompt(person, drop.pushId, location.origin)
    : buildPrompt(person, location.origin, drop);
}

async function copyPrompt(context: ViewContext, brief = false): Promise<void> {
  const prompt = await buildPromptText(context, brief);

  try {
    await navigator.clipboard.writeText(prompt);
    // Watching starts when the waiting card renders, not here — that way the
    // clipboard failing below still leaves a session being watched.
    context.render();
    toast(
      context.state.prefs.gym
        ? 'Prompt copied — paste it to your LLM'
        : 'Prompt copied. Tip: describe your gym above',
    );
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
