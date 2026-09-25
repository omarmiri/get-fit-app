/**
 * Google sign-in, run by this app rather than by Supabase.
 *
 * ## Why this exists
 *
 * Supabase will happily do the whole OAuth dance itself, and it did. The
 * problem is a string: Google's consent screen labels the app by the host of
 * the `redirect_uri`, so every user was asked to "continue to
 * ynmhamemopojogpmfhkw.supabase.co" at the exact moment they were deciding
 * whether to trust it with their Google account.
 *
 * That is not a setting. Setting an app name, adding and verifying the real
 * domain, and publishing the app were each tried and each changed nothing —
 * Google is deliberately reporting where the data actually goes. The only way
 * to change what it says is to make it true, which means the redirect has to
 * land on a domain this app owns.
 *
 * So the flow moves here. Google redirects to `fitness.miriogames.com`, this
 * process exchanges the code, and the resulting Google identity is handed to
 * Supabase for a session. Supabase is still the identity provider and still
 * issues every token the app trusts; it is no longer the doorway.
 *
 * ## What the browser never sees
 *
 * The client secret, and the authorization code. Both stay in this process.
 * The browser leaves for Google, comes back to `/auth/callback`, and is
 * redirected on with a Supabase session — the same shape it used to receive
 * from Supabase directly, so the client that reads it is unchanged.
 *
 * ## What is stored, and for how long
 *
 * One record per sign-in attempt, holding the CSRF state, the OpenID nonce and
 * where to return to, for ten minutes. It contains nothing about the person —
 * at the time it is written, nobody knows who they are yet.
 */

import { createHash } from 'node:crypto';

import * as auth from './auth.js';
import { kvDelete, kvGet, kvSet } from './kv.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

/** How long a started sign-in may take to come back. */
const PENDING_TTL_MS = 10 * 60 * 1000;

const pendingKey = (state) => `fit:oauth:${state}`;

/**
 * Whether this app can run the flow itself.
 *
 * Supabase must be configured too: this handles the Google half and then needs
 * somewhere to turn a Google identity into a session. Without both, sign-in
 * falls back to Supabase's own authorize endpoint, which still works — it just
 * shows the project hostname on the consent screen.
 */
export const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET && auth.configured());

export class GoogleAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
  }
}

/** URL-safe random, for values that are compared rather than read. */
function random(bytes = 32) {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

/**
 * Begin a sign-in. Returns the Google URL to send the browser to.
 *
 * `redirectUri` is derived from the incoming request rather than configured,
 * so the same build works on localhost and in production without a second
 * environment variable to keep in step. Google requires an exact match against
 * its allow-list, which is what stops that being a way to redirect anywhere.
 */
export async function beginSignIn({ redirectUri, returnTo }) {
  if (!configured()) {
    throw new GoogleAuthError('Google sign-in is not configured on this server.', 503);
  }

  const state = random();
  const nonce = random();

  await kvSet(pendingKey(state), { nonce, returnTo, redirectUri }, PENDING_TTL_MS);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    // `openid` is what makes Google return an id_token, which is the only part
    // Supabase needs. The other two are what the app shows in the UI.
    scope: 'openid email profile',
    state,
    /*
     * Hashed for Google, raw for Supabase. Supabase hashes the nonce it is
     * given and compares that with the one inside the id_token, so sending the
     * same raw value to both fails every sign-in with "Nonces mismatch".
     */
    nonce: createHash('sha256').update(nonce).digest('hex'),
    // Without this Google silently reuses a prior grant and never returns a
    // refresh token, which is fine here — the Supabase session is what gets
    // refreshed — but `select_account` is what makes a second sign-in on a
    // shared device actually offer a choice.
    prompt: 'select_account',
  });

  return `${AUTHORIZE}?${params.toString()}`;
}

/**
 * Finish a sign-in: Google's code in, a Supabase session out.
 *
 * Returns `{ session, returnTo }`. Throws `GoogleAuthError` with a message
 * safe to show a user.
 */
export async function completeSignIn({ code, state }) {
  if (!configured()) {
    throw new GoogleAuthError('Google sign-in is not configured on this server.', 503);
  }
  if (!code || !state) {
    throw new GoogleAuthError('That sign-in did not come back complete. Try again.', 400);
  }

  /*
   * The state must have been issued by this app and must not have been used
   * already. Reading it from the store and not writing it back is what makes
   * it single-use: a replayed callback finds nothing.
   */
  const pending = await kvGet(pendingKey(state));
  if (!pending) {
    throw new GoogleAuthError('That sign-in has expired or was already used. Try again.', 400);
  }
  await kvDelete(pendingKey(state));

  const idToken = await exchangeCode(code, pending.redirectUri);
  const session = await sessionFromIdToken(idToken, pending.nonce);

  return { session, returnTo: pending.returnTo };
}

/** Swap Google's one-time code for an id_token. */
async function exchangeCode(code, redirectUri) {
  let response;
  try {
    response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    throw new GoogleAuthError('Could not reach Google. Try again.', 502);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.id_token) {
    /*
     * Google's `error_description` is the useful half — "redirect_uri_mismatch"
     * points straight at the console configuration, where the bare `error` says
     * only "invalid_request". Logged, not returned: it describes this app's
     * setup rather than anything the user did.
     */
    console.error(
      `[google] token exchange failed: ${body?.error_description ?? body?.error ?? response.status}`,
    );
    throw new GoogleAuthError('Google would not complete that sign-in.', 502);
  }

  return body.id_token;
}

/**
 * Turn a Google identity into a Supabase session.
 *
 * Supabase verifies the id_token against Google's public keys itself, so this
 * app never has to, and checks the nonce against the one that was sent to
 * Google — which is why it has to be carried through the pending record rather
 * than generated here.
 */
async function sessionFromIdToken(idToken, nonce) {
  const { url } = auth.info();

  let response;
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=id_token`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY ?? '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ provider: 'google', id_token: idToken, nonce }),
    });
  } catch {
    throw new GoogleAuthError('Could not reach the account service. Try again.', 502);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.access_token) {
    console.error(
      `[google] session exchange failed: ${body?.error_description ?? body?.msg ?? response.status}`,
    );
    throw new GoogleAuthError('Could not finish signing you in.', 502);
  }

  return body;
}

/**
 * Where to send the browser once there is a session.
 *
 * The tokens go in the fragment, which is what Supabase's own redirect did and
 * therefore what the client already knows how to read — `captureRedirectSession`
 * is unchanged by any of this. A fragment is also never sent to a server, so
 * the tokens do not end up in this app's own access logs on the way back in.
 */
export function successUrl(returnTo, session) {
  const fragment = new URLSearchParams({
    access_token: session.access_token ?? '',
    refresh_token: session.refresh_token ?? '',
    expires_in: String(session.expires_in ?? 3600),
    token_type: 'bearer',
    ...(session.user?.id ? { provider_id: session.user.id } : {}),
  });

  return `${returnTo}#${fragment.toString()}`;
}

/**
 * Where to send the browser when it did not work.
 *
 * The query string, not the fragment — matching where Supabase reported
 * provider failures, and therefore where the client already looks. See the note
 * on the two places in `services/account.ts`.
 */
export function failureUrl(returnTo, message) {
  const query = new URLSearchParams({ error: 'sign_in_failed', error_description: message });
  return `${returnTo}?${query.toString()}`;
}
