import type { AppState } from '@/types';

/**
 * Client side of accounts.
 *
 * Talks only to this app's own origin. Every call to the identity provider is
 * proxied by the server, so there is no Supabase SDK here, no anon key in the
 * bundle, and `connect-src 'self'` holds exactly as it did before accounts
 * existed.
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

let available: boolean | null = null;

/** Whether this deploy has accounts configured, so the UI can stay quiet if not. */
export async function accountsAvailable(): Promise<boolean> {
  if (available !== null) return available;

  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) return (available = false);
    const body: unknown = await response.json();
    available = (body as { auth?: { configured?: boolean } })?.auth?.configured === true;
  } catch {
    available = false;
  }
  return available;
}

/* -------------------------------------------------------------- sign-in */

export async function requestCode(email: string): Promise<void> {
  await postJson('/api/auth/code', { email });
}

export async function verifyCode(email: string, code: string): Promise<AccountUser> {
  const body = await postJson('/api/auth/verify', { email, code });

  const user = (body as { user?: AccountUser }).user;
  const accessToken = (body as { accessToken?: string }).accessToken ?? '';
  const refreshToken = (body as { refreshToken?: string }).refreshToken ?? '';
  const expiresIn = (body as { expiresIn?: number }).expiresIn ?? 3600;

  if (!user || !accessToken) throw new AccountError('Signing in did not return a session.', 502);

  writeSession({ accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000, user });
  return user;
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
