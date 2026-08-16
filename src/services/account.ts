import type { AppState } from '@/types';

/**
 * Client side of accounts.
 *
 * Every *fetch* goes to this app's own origin — there is no Supabase SDK here,
 * no anon key in the bundle, and `connect-src 'self'` is untouched.
 *
 * The one exception is deliberate and unavoidable: signing in with Google is a
 * top-level navigation to Supabase, which hands off to Google and comes back
 * here with tokens in the URL fragment. That is a navigation rather than a
 * fetch, so no CSP directive relaxes for it, but it is still the moment the
 * browser leaves this origin and it should not be discovered by surprise.
 *
 * ## Signing in is optional and stays optional
 *
 * The app worked with no account before it had any, and that has to keep being
 * true — it is why it runs in a basement gym. An account buys one thing:
 * durability. Clearing browser data stops being the end of your training
 * history. It does not gate logging a set, and nothing in `state/` knows this
 * module exists.
 *
 * ## Backup, not sync
 *
 * The device is the source of truth. It pushes its whole state after changes
 * and pulls on sign-in. There is no merge because there is no second device to
 * merge with — see `account.js` on the server for what would have to change if
 * that stopped being true.
 */

const SESSION_KEY = 'rackfile:session';

export interface AccountUser {
  readonly id: string;
  readonly email: string;
}

interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch ms after which the access token is assumed dead. */
  readonly expiresAt: number;
  readonly user: AccountUser;
}

export class AccountError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
  }
}

/* ---------------------------------------------------------------- session */

let cached: StoredSession | null | undefined;

function readSession(): StoredSession | null {
  if (cached !== undefined) return cached;

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    cached =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredSession).accessToken === 'string' &&
      typeof (parsed as StoredSession).refreshToken === 'string'
        ? (parsed as StoredSession)
        : null;
  } catch {
    // A corrupt session is not worth failing the app over — it just means
    // signing in again.
    cached = null;
  }
  return cached;
}

function writeSession(session: StoredSession | null): void {
  cached = session;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be full or blocked. Sign-in still works for this tab.
  }
}

/** The signed-in user, or `null`. Does not hit the network. */
export function currentUser(): AccountUser | null {
  return readSession()?.user ?? null;
}

export function signOut(): void {
  writeSession(null);
}

/* ------------------------------------------------------------ availability */

interface AuthConfig {
  readonly configured: boolean;
  readonly url: string;
}

let config: AuthConfig | null = null;

/** Whether this deploy has accounts configured, so the UI can stay quiet if not. */
export async function accountsAvailable(): Promise<boolean> {
  return (await loadConfig()).configured;
}

async function loadConfig(): Promise<AuthConfig> {
  if (config) return config;

  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) return (config = { configured: false, url: '' });

    const body: unknown = await response.json();
    const auth = (body as { auth?: { configured?: boolean; url?: string } })?.auth;
    config = { configured: auth?.configured === true, url: auth?.url ?? '' };
  } catch {
    config = { configured: false, url: '' };
  }
  return config;
}

/* -------------------------------------------------------------- sign-in */

/**
 * Leave for Google.
 *
 * Returns only if it could not start — a successful call navigates away and
 * nothing after it runs.
 */
export async function signInWithGoogle(): Promise<void> {
  const { configured, url } = await loadConfig();
  if (!configured || !url) throw new AccountError('Accounts are not set up on this server.', 503);

  /*
   * Come back to the page the user was on, without any query or fragment.
   * Supabase appends its own fragment on return, and handing it a URL that
   * already had one would produce something neither side can parse.
   */
  const returnTo = `${location.origin}${location.pathname}`;
  location.assign(
    `${url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(returnTo)}`,
  );
}

/**
 * Pick up the session Supabase leaves in the URL fragment after a redirect.
 *
 * Returns the user when a sign-in just completed, `null` otherwise. Call once
 * on load, before anything reads the session.
 *
 * The fragment is stripped immediately and unconditionally. Tokens in a URL
 * are tokens in the back button, in `document.referrer` on the next
 * navigation, and in whatever the user pastes when they share a link — so the
 * window in which they are visible is kept to the shortest thing achievable,
 * and `replaceState` is used so the tokenful entry does not stay in history.
 */
export function captureRedirectSession(): AccountUser | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!raw || !/(^|&)(access_token|error|error_description)=/.test(raw)) return null;

  const params = new URLSearchParams(raw);
  history.replaceState(null, '', `${location.pathname}${location.search}`);

  const accessToken = params.get('access_token') ?? '';
  if (!accessToken) {
    // Supabase reports refusals here too — a cancelled consent screen, or a
    // provider that is not enabled on the project.
    lastRedirectError = params.get('error_description') ?? params.get('error');
    return null;
  }

  /*
   * The user is claimed from the fragment, which is untrusted input. It is
   * used for the greeting only — every request that matters sends the bearer
   * token, and the server resolves identity from Supabase rather than from
   * anything this function returns.
   */
  const user: AccountUser = {
    id: params.get('provider_id') ?? 'signed-in',
    email: '',
  };

  writeSession({
    accessToken,
    refreshToken: params.get('refresh_token') ?? '',
    expiresAt: Date.now() + Number(params.get('expires_in') ?? 3600) * 1000,
    user,
  });

  return user;
}

let lastRedirectError: string | null = null;

/** Why the last redirect failed, if it did. Read once and cleared. */
export function takeRedirectError(): string | null {
  const error = lastRedirectError;
  lastRedirectError = null;
  return error;
}

/**
 * Ask the server who the token belongs to, and record it.
 *
 * The fragment does not carry the email, and the greeting should say something
 * truer than "signed in". This is also the first real check that the token
 * works at all.
 */
export async function refreshIdentity(): Promise<AccountUser | null> {
  const session = readSession();
  if (!session) return null;

  try {
    const body = await authedJson('/api/account/me', { method: 'GET' });
    const user = (body as { user?: AccountUser | null }).user;
    if (!user) return null;

    writeSession({ ...session, user });
    return user;
  } catch {
    return null;
  }
}

/**
 * Swap the refresh token for a fresh session.
 *
 * Returns `false` when the refresh itself failed, which means the session is
 * genuinely over — the caller signs out rather than retrying into a loop.
 */
async function refresh(): Promise<boolean> {
  const session = readSession();
  if (!session?.refreshToken) return false;

  try {
    const body = await postJson('/api/auth/refresh', { refreshToken: session.refreshToken });
    const accessToken = (body as { accessToken?: string }).accessToken ?? '';
    if (!accessToken) return false;

    writeSession({
      accessToken,
      refreshToken: (body as { refreshToken?: string }).refreshToken ?? session.refreshToken,
      expiresAt: Date.now() + ((body as { expiresIn?: number }).expiresIn ?? 3600) * 1000,
      user: (body as { user?: AccountUser }).user ?? session.user,
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ state */

/**
 * The state stored for this account, or `null` when there is none yet.
 *
 * `null` is the normal answer on a first sign-in and means "nothing up here
 * yet" — never "wipe what you have".
 */
export async function pullState(): Promise<AppState | null> {
  const body = await authedJson('/api/account/state', { method: 'GET' });
  const state = (body as { state?: unknown }).state;
  return state && typeof state === 'object' ? (state as AppState) : null;
}

export async function pushState(state: AppState): Promise<void> {
  await authedJson('/api/account/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
}

/* ----------------------------------------------------------------- fetch */

async function postJson(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AccountError('Could not reach the server. Check your connection.', 0);
  }
  return unwrap(response);
}

/**
 * A request carrying the session, refreshed once on a 401.
 *
 * Once, deliberately: if a refreshed token is also rejected, the session is
 * over, and retrying is how a client ends up hammering an endpoint that will
 * never say yes.
 */
async function authedJson(path: string, init: RequestInit, retry = true): Promise<unknown> {
  const session = readSession();
  if (!session) throw new AccountError('Not signed in.', 401);

  // Refreshed slightly early, so a request does not fail on a token that
  // expires between the check and the server reading it.
  if (session.expiresAt - 30_000 < Date.now() && retry) {
    if (!(await refresh())) {
      signOut();
      throw new AccountError('Your session expired. Sign in again.', 401);
    }
    return authedJson(path, init, false);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${readSession()?.accessToken ?? ''}` },
    });
  } catch {
    throw new AccountError('Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 401 && retry) {
    if (!(await refresh())) {
      signOut();
      throw new AccountError('Your session expired. Sign in again.', 401);
    }
    return authedJson(path, init, false);
  }

  return unwrap(response);
}

async function unwrap(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${response.status}).`;
    throw new AccountError(message, response.status);
  }
  return body ?? {};
}
