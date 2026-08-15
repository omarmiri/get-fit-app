import {
  AccountError,
  accountsAvailable,
  currentUser,
  pullState,
  pushState,
  requestCode,
  signOut,
  verifyCode,
} from '@/services/account';
import { parseState } from '@/state/schema';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';

/**
 * Optional backup to an account.
 *
 * ## What this is for, and what it is not
 *
 * One thing: clearing browser data stops being the end of your training
 * history. It is not sync — there is no second device to reconcile with — and
 * it is not a login wall. Everything in the app works signed out, which is why
 * this card sits at the bottom of the Plan tab rather than in front of the
 * first session.
 *
 * The card hides itself entirely on a deploy with no accounts configured. An
 * offer to sign in to nowhere is worse than no offer.
 *
 * ## Health context is not in the backup
 *
 * Nothing sensitive is: health context is per-session input that never reaches
 * persisted state, so there is nothing here to promise about it. See
 * `state/ephemeral.ts`.
 */

type Stage = 'idle' | 'code-sent';

interface AccountUi {
  available: boolean | null;
  stage: Stage;
  email: string;
  code: string;
  busy: boolean;
  error: string | null;
}

const ui: AccountUi = {
  available: null,
  stage: 'idle',
  email: '',
  code: '',
  busy: false,
  error: null,
};

/** Probe once per load, then redraw if accounts turn out to exist. */
export function initAccountCard(render: () => void): void {
  void accountsAvailable().then((available) => {
    if (ui.available === available) return;
    ui.available = available;
    render();
  });
}

export function renderAccountCard(context: ViewContext): HTMLElement | null {
  if (ui.available !== true) return null;

  const user = currentUser();
  return user ? renderSignedIn(context, user.email) : renderSignedOut(context);
}

function renderSignedIn(context: ViewContext, email: string): HTMLElement {
  return card([
    eyebrow('Backup'),
    text('setting__label', email),
    text(
      'prose',
      'Your plans, sessions and settings are backed up to this account. Clearing your browser will not lose them.',
    ),

    el('button', {
      class: 'button button--ghost',
      text: ui.busy ? 'Working…' : 'Back up now',
      attrs: { type: 'button', disabled: ui.busy },
      on: { click: () => void backUp(context) },
    }),

    el('button', {
      class: 'button button--ghost',
      text: 'Restore from backup',
      attrs: { type: 'button', disabled: ui.busy },
      on: { click: () => void restore(context) },
    }),

    el('button', {
      class: 'button button--ghost',
      text: 'Sign out',
      attrs: { type: 'button' },
      on: {
        click: () => {
          signOut();
          // Signing out leaves the device's data alone. The account is a copy,
          // not the original, and deleting the original on sign-out would be a
          // surprising way to lose a training history.
          toast('Signed out — your data is still on this device');
          context.render();
        },
      },
    }),

    ui.error ? div('notice notice--warn', [text('notice__body', ui.error)]) : null,
  ]);
}

function renderSignedOut(context: ViewContext): HTMLElement {
  return card([
    eyebrow('Backup'),
    text(
      'prose',
      'Everything is stored on this device. Sign in with an email code to keep a copy, so clearing your browser does not lose your training history. Optional — the app works exactly the same without it.',
    ),

    ui.stage === 'idle'
      ? div('gen__group', [
          el('input', {
            class: 'gen__input',
            attrs: {
              type: 'email',
              inputmode: 'email',
              autocomplete: 'email',
              placeholder: 'you@example.com',
              value: ui.email,
              'aria-label': 'Email address',
            },
            on: {
              input: (event) => {
                ui.email = (event.target as HTMLInputElement).value;
              },
            },
          }),
          el('button', {
            class: 'button button--primary',
            text: ui.busy ? 'Sending…' : 'Email me a code',
            attrs: { type: 'button', disabled: ui.busy },
            on: { click: () => void sendCode(context) },
          }),
        ])
      : div('gen__group', [
          text('club__hint', `Code sent to ${ui.email}. It expires shortly.`),
          el('input', {
            class: 'gen__input',
            attrs: {
              type: 'text',
              inputmode: 'numeric',
              autocomplete: 'one-time-code',
              placeholder: '123456',
              value: ui.code,
              'aria-label': 'Sign-in code',
            },
            on: {
              input: (event) => {
                ui.code = (event.target as HTMLInputElement).value;
              },
            },
          }),
          el('button', {
            class: 'button button--primary',
            text: ui.busy ? 'Checking…' : 'Sign in',
            attrs: { type: 'button', disabled: ui.busy },
            on: { click: () => void submitCode(context) },
          }),
          el('button', {
            class: 'button button--ghost',
            text: 'Use a different email',
            attrs: { type: 'button' },
            on: {
              click: () => {
                ui.stage = 'idle';
                ui.code = '';
                ui.error = null;
                context.render();
              },
            },
          }),
        ]),

    ui.error ? div('notice notice--warn', [text('notice__body', ui.error)]) : null,
  ]);
}

/* ----------------------------------------------------------------- actions */

async function sendCode(context: ViewContext): Promise<void> {
  if (ui.busy) return;
  await run(context, async () => {
    await requestCode(ui.email.trim());
    ui.stage = 'code-sent';
    ui.code = '';
    toast('Check your email for a code');
  });
}

async function submitCode(context: ViewContext): Promise<void> {
  if (ui.busy) return;
  await run(context, async () => {
    await verifyCode(ui.email.trim(), ui.code.trim());
    ui.stage = 'idle';
    ui.code = '';

    /*
     * First thing after signing in: push what is already here.
     *
     * The device is the source of truth, and someone who has been training for
     * months before making an account must not have that overwritten by the
     * empty state of a fresh one. Restoring is a separate, explicit action.
     */
    await pushState(context.state);
    toast('Signed in — this device is backed up');
  });
}

async function backUp(context: ViewContext): Promise<void> {
  if (ui.busy) return;
  await run(context, async () => {
    await pushState(context.state);
    toast('Backed up');
  });
}

/**
 * Replace this device's data with the account's copy.
 *
 * Confirmed twice and named plainly, because it is the one destructive thing
 * on this card: restoring an older backup over a session logged this morning
 * loses that session, and there is no undo.
 */
async function restore(context: ViewContext): Promise<void> {
  if (ui.busy) return;

  await run(context, async () => {
    const remote = await pullState();
    if (!remote) {
      toast('Nothing backed up yet');
      return;
    }

    // Parsed rather than trusted: it went up from a client, and it comes back
    // through the same total parser as any other untrusted input.
    const parsed = parseState(remote);
    if (!parsed.recognised) {
      ui.error = 'The backup could not be read.';
      return;
    }

    const incoming = parsed.state.sessions.length;
    const here = context.state.sessions.length;
    if (
      !confirm(
        `Replace this device's data with the backup?\n\nHere: ${here} sessions\nBackup: ${incoming} sessions\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }

    context.store.replaceState(parsed.state);
    toast(`Restored ${incoming} ${incoming === 1 ? 'session' : 'sessions'}`);
  });
}

/** Shared busy/error handling, so every action reports the same way. */
async function run(context: ViewContext, action: () => Promise<void>): Promise<void> {
  ui.busy = true;
  ui.error = null;
  context.render();

  try {
    await action();
  } catch (error) {
    ui.error = error instanceof AccountError ? error.message : 'Something went wrong. Try again.';
  } finally {
    ui.busy = false;
    context.render();
  }
}
