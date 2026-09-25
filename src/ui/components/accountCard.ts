import {
  AccountError,
  accountsAvailable,
  currentUser,
  signInWithGoogle,
  signOut,
  takeRedirectError,
} from '@/services/account';
import { forgetSyncBase } from '@/services/sync';
import { card, div, el, eyebrow, text } from '../dom';
import { toast } from '../toast';
import type { ViewContext } from '../views/context';

/**
 * Optional account: a backup, and the same plans and history on every device.
 *
 * ## What this is for, and what it is not
 *
 * Two things. Clearing browser data stops being the end of your training
 * history, and a plan written on the PC is waiting on the phone at the gym.
 * It is not a login wall. Everything in the app works signed out, which is why
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

interface AccountUi {
  available: boolean | null;
  busy: boolean;
  error: string | null;
}

const ui: AccountUi = {
  available: null,
  busy: false,
  error: null,
};

/** Probe once per load, then redraw if accounts turn out to exist. */
export function initAccountCard(render: () => void): void {
  // A refusal reported in the returning URL fragment — a cancelled consent
  // screen, or Google not enabled on the project — is surfaced rather than
  // leaving the user on a page that simply did not change.
  ui.error = takeRedirectError();

  void accountsAvailable().then((available) => {
    if (ui.available === available && !ui.error) return;
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
    eyebrow('Account'),
    text('setting__label', email),
    /*
     * No sync controls. Sync runs on sign-in, on opening the app, on coming
     * back to it and after changes — see `services/sync.ts` — so a button
     * could only ever do what had already happened, and "Restore" (replace
     * this device with the account's copy) was the one destructive action
     * here, made unnecessary by merging.
     */
    text('prose', 'Your plans and workouts stay in sync on every device you sign in on.'),

    el('button', {
      class: 'button button--ghost',
      text: 'Sign out',
      attrs: { type: 'button' },
      on: {
        click: () => {
          signOut();
          forgetSyncBase();
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
    eyebrow('Account'),
    text(
      'prose',
      'Sign in to keep your plans and workouts on all your devices. Optional — the app works the same without it.',
    ),

    el('button', {
      class: 'button button--primary',
      text: ui.busy ? 'Opening Google…' : 'Continue with Google',
      attrs: { type: 'button', disabled: ui.busy },
      on: { click: () => void startSignIn(context) },
    }),

    text(
      'club__hint',
      'Takes you to Google and back. Your training data is never sent to Google — it only confirms who you are.',
    ),

    ui.error ? div('notice notice--warn', [text('notice__body', ui.error)]) : null,
  ]);
}

/* ----------------------------------------------------------------- actions */

async function startSignIn(context: ViewContext): Promise<void> {
  if (ui.busy) return;
  await run(context, async () => {
    // Navigates away on success; nothing after this runs. The busy state is
    // for the moment before the browser leaves, and for the case where it
    // cannot.
    await signInWithGoogle();
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
