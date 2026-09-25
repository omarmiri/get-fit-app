import type { UserPlan } from '@/types';
import { ALL_STATIONS, stationName } from '@/data/equipment';
import { LLM_PROVIDERS, fitsInLink } from '@/data/llmProviders';
import { type PlanValidation, validatePlan } from '@/domain/planValidation';
import { parsePortablePlan } from '@/domain/planFormat';
import { withSavedMovements } from '@/data/catalogue';
import { buildBriefPrompt, buildLinkPrompt, buildPrompt } from '@/spec/planSpec';
import { clearDrop, currentDrop, dropEndpoint, openDrop, pollDrop } from '@/services/planDrop';
import { conditionsList, getNotes } from '@/state/ephemeral';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';
import { renderPlanCandidate } from './planCandidate';

/** How many of the user's saved movements a prompt names. */
const SAVED_MOVEMENTS_IN_PROMPT = 30;

/**
 * Bring in a plan written by whichever LLM the user prefers.
 *
 * Three steps, in the order someone actually performs them: send a prompt,
 * tap the link that comes back, or — when the model could not manage a link —
 * bring the answer back by hand.
 *
 * The link is the whole point of the arrangement. A plan in JSON is too big to
 * put in a URL, so a compact form of the same week travels in the fragment
 * instead and the user taps once; see `domain/compactPlan.ts`. Everything else
 * here is what happens when that does not work, and none of it is hidden,
 * because a model that cannot build a link will not always admit it.
 *
 * All of it works offline and none involves any third party. An earlier
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
  /** Whether the fallback routes are showing. Closed by default — see below. */
  others: boolean;
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
  others: false,
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
  state.others = false;
  stopWatching();
}

/**
 * Two steps and a fold.
 *
 * ## Why almost everything is behind the fold
 *
 * This card grew a control at a time — a copy button, then launchers, then a
 * clipboard reader, then a paste box, then a file picker — until it offered
 * nine ways to do one job. Numbering them helped, but it still presented five
 * fallbacks with the same weight as the thing that works, which reads as five
 * decisions rather than one path.
 *
 * Now that the link works there is a normal way through: open a chatbot, tap
 * the link that comes back. That is the card. Everything else is one tap away
 * under "Other ways to import", because every one of those routes exists for a
 * specific failure and none of them are the normal case any more.
 *
 * What is *not* folded away is anything that reports a result — the waiting
 * card, the paste box once opened, an error, a plan to review. A result hidden
 * behind a toggle the user has since closed is a result they never see.
 */
export function renderPlanImport(context: ViewContext): HTMLElement {
  return card([
    eyebrow('Bring a plan from any LLM'),
    text(
      'prose',
      'Any chatbot can write a week this app understands. It takes about a minute and nothing about you is sent anywhere by this app — the prompt is built here, on your device.',
    ),

    /* ------------------------------------------------------------ the path */

    eyebrow('1 · Send the prompt'),
    div('gen__group', [
      text('prose', 'Opens with the prompt already in it:'),
      ...renderLaunchers(context),
    ]),

    eyebrow('2 · Tap the link it gives you'),
    text(
      'prose',
      'The reply ends with an "Open in Rack & File" link. Tapping it brings the whole week straight here — nothing to copy, nothing to paste.',
    ),

    /* ---------------------------------------------------------- everything else */

    el('button', {
      class: 'button button--ghost',
      text: state.others ? 'Hide the other ways' : 'Other ways to import',
      attrs: { type: 'button', 'aria-expanded': state.others },
      on: {
        click: () => {
          state.others = !state.others;
          context.render();
        },
      },
    }),

    state.others ? renderOtherWays(context) : null,

    /* ----------------------------------------------------------- what happened */

    // Outside the fold on purpose: these say what the app is doing or what it
    // found, and a result hidden behind a toggle the user has since closed is
    // a result they will never see.

    // Only the connector prompt opens a session, so this only appears for
    // someone who took that route.
    state.pushId && !state.candidate ? renderWaiting(context) : null,

    state.open ? renderPasteBox(context) : null,
  ]);
}

/**
 * Whether a plan — or the reason one could not be read — is waiting to be seen.
 *
 * The shell asks this before deciding to show the welcome screen, because the
 * most common first visit is someone tapping the link their chatbot just gave
 * them. A welcome screen asking how they want to train, standing in front of
 * the plan they already brought, reads as the link not working.
 */
export function hasPendingPlan(): boolean {
  return state.candidate !== null || state.error !== null;
}

/**
 * The plan that just arrived, or why it could not be read.
 *
 * Rendered at the top of the Plan tab whatever screen it is on, rather than
 * inside the import card. That card lives on the last step of the "write me
 * a new week" wizard, and a plan arriving by link, paste or push has nothing
 * to do with where the wizard was — so it used to arrive, correctly parsed,
 * on a screen nobody was looking at.
 */
export function renderPendingPlan(context: ViewContext): HTMLElement | null {
  if (!hasPendingPlan()) return null;

  return div('pending', [
    state.error
      ? div('notice notice--warn', [
          text('notice__body', state.error),
          el('button', {
            class: 'button button--ghost',
            text: 'Dismiss',
            attrs: { type: 'button' },
            on: {
              click: () => {
                state.error = null;
                context.render();
              },
            },
          }),
        ])
      : null,

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
            state.error = null;
            context.render();
          },
        })
      : null,
  ]);
}

/** Bring the user to a plan that has just arrived, wherever they were. */
function showPending(context: ViewContext): void {
  context.ui.tab = 'plan';
  context.render();
  window.scrollTo(0, 0);
}

/**
 * The routes that are no longer the normal one.
 *
 * ## Why these are folded away rather than removed
 *
 * Each exists because something specific fails. A model that cannot fetch
 * `/llms.txt` needs the whole contract pasted to it. A model that writes a
 * good week and then mangles the link leaves the JSON in the reply, and the
 * clipboard is the way to collect it. A phone that downloaded the plan as a
 * file needs the file picker. None of that stopped being true when the link
 * started working — it just stopped being what most people do.
 *
 * So the card shows one path and keeps the rest one tap away. The important
 * fallback is not even in here: a paste anywhere on the page is caught by
 * `watchPastedPlans` whether this section is open or closed, so the route
 * someone reaches for by instinct never depends on having found this button.
 */
function renderOtherWays(context: ViewContext): HTMLElement {
  return div('gen__group', [
    text(
      'prose',
      'If a model cannot fetch the format, or writes the plan but not the link, these still work.',
    ),

    /*
     * The launchers carry the short prompt, which needs the model to fetch the
     * format; this one carries the whole 15kb contract and works in anything,
     * including a model with no network at all. It is the honest answer for
     * Gemini and Copilot, which cannot be opened with a prompt.
     */
    el('button', {
      class: 'button button--ghost',
      text: 'Copy the prompt instead',
      attrs: { type: 'button', title: 'Carries the whole format inline — paste it into any chatbot' },
      on: { click: () => void copyPrompt(context) },
    }),

    el('button', {
      class: 'button button--ghost',
      text: 'Paste plan from clipboard',
      attrs: { type: 'button', title: 'Or just press Ctrl-V anywhere on this page' },
      on: { click: () => void importFromClipboard(context) },
    }),

    el('button', {
      class: 'button button--ghost',
      text: state.open ? 'Hide the paste box' : 'Use a paste box',
      attrs: { type: 'button', 'aria-expanded': state.open },
      on: {
        click: () => {
          state.open = !state.open;
          context.render();
        },
      },
    }),

    renderFileButton(context),

    /*
     * Offered rather than detected, because the app has no way to know what a
     * user has configured in someone else's chat client. No consumer product
     * ships this connector today, so it sits last and says what it is for.
     */
    el('button', {
      class: 'button button--ghost',
      text: 'Copy short prompt (connector)',
      attrs: { type: 'button', title: 'For clients with the Rack & File connector added' },
      on: { click: () => void copyPrompt(context, 'connector') },
    }),
  ]);
}

/**
 * A plan arriving from outside the app: a tapped link, or the system share
 * sheet.
 *
 * ## The three doors, and why they are one function
 *
 * `#plan=` is the one that matters. A model ends its reply with **Open in Rack
 * & File** and the whole week rides in the fragment, so the user taps once and
 * is looking at the review card — no copy, no app switch, no paste. It is a
 * fragment rather than a query because a fragment is never sent to a server:
 * not to the access log, not to CloudFront, and not through a `Referer`.
 *
 * `?plan=` is the same thing built slightly wrong, which a model will do often
 * enough to be worth accepting. It costs one line here and saves a link that
 * would otherwise open the app and do nothing. The query is stripped
 * immediately either way.
 *
 * `?shared=` is Android's share sheet, which delivers to the manifest's
 * `share_target` as an ordinary navigation.
 *
 * All three are cleaned out of the URL whether or not what they carried turned
 * out to be a plan. Leaving one would mean a refresh re-importing something
 * already dealt with, and a training plan sitting in the address bar, the back
 * button, and any link the user shares onwards — the same reasoning as the
 * tokens in `account.ts`.
 *
 * Returns whether anything was found, so the caller can decide to re-render.
 */
export function captureIncomingPlan(context: ViewContext): boolean {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));

  const incoming = fragment.get('plan') ?? query.get('plan') ?? query.get('shared');
  if (!incoming) return false;

  query.delete('plan');
  query.delete('shared');
  query.delete('shared_title');
  fragment.delete('plan');

  const search = query.toString();
  const rest = fragment.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${rest ? `#${rest}` : ''}`);

  /*
   * The review card lives on the Plan tab, and someone arriving by link has a
   * plan in hand — so that is the tab they want, whatever they were last
   * looking at. Without this the import silently succeeds on a screen they are
   * not on, which is indistinguishable from the link not working.
   */
  context.ui.tab = 'plan';

  // The same parser as every other route in — it reads the compact link
  // format and JSON alike. Something that was not a plan gets the parser's own
  // explanation rather than a guess about what it might have been.
  review(context, incoming);
  revealCandidate();
  return true;
}

/**
 * Scroll the review card into view once it has been painted.
 *
 * The Plan tab is a long screen — the rotation, the gym, the library, the
 * settings — and the import card sits well down it. Arriving by link or by
 * paste and landing at the top of that screen looks like nothing happened.
 *
 * Two frames rather than one because the caller may run before the first
 * paint: the first frame is the render it asked for, the second is when the
 * card actually has a position.
 */
function revealCandidate(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector('.gen__candidate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
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

    const { plan, incomplete } = parsePortablePlan(pasted);
    if (!plan) return;

    event.preventDefault();

    const context = getContext();
    // The review card lives on the Plan tab, so a paste from anywhere else
    // has to bring the user to it — a candidate rendered on a screen nobody
    // is looking at is the same as no candidate.
    context.ui.tab = 'plan';
    reviewPlan(context, plan, incomplete);
    toast('Plan found on the clipboard — review it below');

    revealCandidate();
  });
}

/**
 * What the app is waiting for, and what to do if it never comes.
 *
 * Only the connector prompt reaches this, because only a client with the MCP
 * server added has any way to push. The ordinary routes no longer open a
 * session at all — an app visibly waiting for something that cannot arrive
 * reads as broken, and it was the app, not the chatbot, that got the blame.
 *
 * Even here it never asks the model whether the push worked. A model asked to
 * POST will sometimes say it did when it did not, so the app goes on what it
 * received, and the paste box stays one tap away the whole time.
 */
function renderWaiting(context: ViewContext): HTMLElement {
  startWatching(context);

  return div('notice', [
    text('notice__body', 'Waiting for your plan. The short prompt asks your connector to send it straight here.'),

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
      'If it says it cannot — most chat clients cannot — just paste the reply instead. Nothing is lost either way.',
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

  const prompt = await buildPromptText(context, 'link');

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

function renderLaunchers(context: ViewContext): HTMLElement[] {
  return LLM_PROVIDERS.map((provider) =>
    el('button', {
      class: 'button button--primary',
      text: provider.name,
      attrs: { type: 'button' },
      on: { click: () => void launch(context, provider.id) },
    }),
  );
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
  const { plan, error, incomplete } = parsePortablePlan(input);

  if (!plan) {
    state.candidate = null;
    state.validation = null;
    state.error = error ?? 'That plan could not be read.';
    showPending(context);
    return;
  }

  reviewPlan(context, plan, incomplete);
}

/**
 * Everything a plan goes through once it is a plan, whichever way it arrived.
 *
 * Pushed and pasted plans meet here. A pushed one has already been through the
 * same parser on the server — that is how it was stored — but parsing answers
 * "is this a plan", and this answers "does it suit the gym this person
 * actually trains in", which is a question only the device can settle.
 */
function reviewPlan(context: ViewContext, incoming: UserPlan, incomplete: readonly string[] = []): void {
  // Movements the plan names from the user's library travel with it from here.
  const plan = withSavedMovements(incoming, context.state.customExercises);

  const missing = context.state.prefs.missingStations ?? [];
  const checked = validatePlan(plan, { missingStationIds: missing });

  // A new movement described only in part blocks the plan like any other
  // error — see `incompleteMovement` for why that is not a warning.
  const validation =
    incomplete.length === 0
      ? checked
      : {
          ...checked,
          ok: false,
          issues: [
            ...incomplete.map((message) => ({ severity: 'error' as const, message })),
            ...checked.issues,
          ],
        };

  state.candidate = plan;
  state.validation = validation;
  state.error = validation.ok
    ? null
    : 'That plan has problems the app cannot work with. The details are below — ask your LLM to fix them and send the new version.';

  showPending(context);
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
/**
 * Which prompt, and therefore how much of the contract it has to carry.
 *
 * - `full` — the whole specification inline, ~15kb. For a paste.
 * - `link` — the person and where the format lives, ~1.8kb. Small enough to
 *   travel in a launcher URL, which is the only reason it exists.
 * - `connector` — the person and a session id. Only honest for a client with
 *   the MCP server added, so it is only ever built when the user says so.
 */
type PromptMode = 'full' | 'link' | 'connector';

async function buildPromptText(context: ViewContext, mode: PromptMode = 'full'): Promise<string> {
  const prefs = context.state.prefs;
  const profile = prefs.profile;
  const missing = new Set(prefs.missingStations ?? []);

  /*
   * A session is opened only for the connector prompt.
   *
   * The ordinary prompt used to open one too, and then ask every model to POST
   * to it. None of the six tested could, so the app was minting a session, and
   * showing a card waiting on it, for a delivery that never arrived — which
   * reads as the app being broken rather than the chatbot being limited. The
   * machinery is intact and the endpoint is still live; it is just no longer
   * offered to clients that have no way to use it.
   */
  let drop: { pushId: string; endpoint: string } | undefined;
  if (mode === 'connector') {
    try {
      const session = await openDrop();
      drop = { pushId: session.pushId, endpoint: dropEndpoint(session.pushId) };
      state.pushId = session.pushId;
    } catch {
      state.pushId = null;
    }
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
    // Only what they have actually crossed off. Listing every station
    // as "available" would be a claim the app cannot support.
    ...(missing.size > 0
      ? { missingEquipment: ALL_STATIONS.filter((s) => missing.has(s.id)).map((s) => stationName(s.id)) }
      : {}),
    // The newest few, so a long library does not crowd the link prompt past
    // what fits in a URL. Older ones are still resolved if a plan names them.
    ...(context.state.customExercises.length > 0
      ? {
          savedMovements: context.state.customExercises
            .slice(-SAVED_MOVEMENTS_IN_PROMPT)
            .map((exercise) => ({ id: exercise.id, name: exercise.name })),
        }
      : {}),
  };

  if (mode === 'link') return buildLinkPrompt(person, location.origin);

  /*
   * The connector prompt is only honest if there is a session to name in it.
   * With no drop open the tools have nothing to submit to, so fall back to the
   * full prompt rather than handing someone an id-shaped hole.
   */
  return mode === 'connector' && drop
    ? buildBriefPrompt(person, drop.pushId, location.origin)
    : buildPrompt(person, location.origin, drop);
}

async function copyPrompt(context: ViewContext, mode: PromptMode = 'full'): Promise<void> {
  const prompt = await buildPromptText(context, mode);

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
