/**
 * Accounts: Supabase as identity provider, nothing more.
 *
 * Ported from `local-atlas/auth.js`, which arrived at this shape for good
 * reasons that apply here too. Differences are noted where they exist.
 *
 * ## What Supabase owns, and what it does not
 *
 * It owns the Google handshake and session refresh. It does NOT own training
 * data: sessions, plans and preferences live in `kv.js` next to everything
 * else durable this app keeps. Running a second database for one JSON blob per
 * user would buy a second thing to operate and a second thing to be down.
 *
 * ## Why verification is a network call
 *
 * `verifyToken` asks Supabase's own `/auth/v1/user` rather than checking a JWT
 * locally. That trades a round-trip — cached below — for not having to pick a
 * signing algorithm, ship a JWT library, or track which of HS256 and the JWKS
 * path a given project issues. At this traffic that is the right way round; if
 * it ever isn't, this is the only function that has to change.
 *
 * ## Anonymous is not a degraded mode
 *
 * This app worked with no account at all before it had any, and that has to
 * keep being true — it is the whole reason it runs in a basement gym. Signing
 * in adds durability across devices and browsers. It does not gate logging a
 * set, following a plan, or anything else on the Today tab, and `requireUser`
 * is deliberately only used where a request costs the operator money or
 * touches an account's stored state.
 */

/* Render's dashboard accepts hyphens in variable names, so read both. */
function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

const SUPA_URL = env('SUPABASE_URL', 'SUPABASE-URL').replace(/\/$/, '');

/*
 * The anon key is designed to be public, but it never leaves this process:
 * every call that needs it is made server-side, and the one thing the browser
 * does itself — the OAuth navigation — does not require it.
 */
const SUPA_ANON = env('SUPABASE_ANON_KEY', 'SUPABASE-ANON-KEY');

export const configured = () => Boolean(SUPA_URL) && Boolean(SUPA_ANON);

/**
 * How long a verified token is trusted without re-asking.
 *
 * The cost is worth stating plainly: for up to this long after a sign-out, a
 * stolen copy of that token still verifies. A minute is well short of the
 * token's own hour-long lifetime, which is the real bound.
 */
const TOKEN_TTL_MS = 60_000;

/** Verified tokens, hashed rather than stored raw. */
const tokenCache = new Map();

function cacheKey(token) {
  // Hashing keeps raw bearer tokens out of process memory as map keys, where
  // a heap dump would otherwise hand over working credentials.
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return `${token.length}:${hash}`;
}

function cacheGet(token) {
  const hit = tokenCache.get(cacheKey(token));
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    tokenCache.delete(cacheKey(token));
    return null;
  }
  return hit.user;
}

function cacheSet(token, user) {
  // Bounded so a long-running process cannot accumulate entries from a stream
  // of distinct tokens. Expired entries go first; failing that, the oldest.
  if (tokenCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of tokenCache) {
      if (entry.expires <= now) tokenCache.delete(key);
    }
    while (tokenCache.size > 400) {
      const oldest = tokenCache.keys().next();
      if (oldest.done) break;
      tokenCache.delete(oldest.value);
    }
  }
  tokenCache.set(cacheKey(token), { user, expires: Date.now() + TOKEN_TTL_MS });
}

/** Resolve a bearer token to a user, or `null`. Never throws. */
export async function verifyToken(token) {
  if (!configured() || !token) return null;

  const cached = cacheGet(token);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_ANON, Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  if (!body?.id) return null;

  const user = { id: body.id, email: body.email ?? '' };
  cacheSet(token, user);
  return user;
}

function bearer(req) {
  const header = String(req.get('authorization') ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

/**
 * Attach `req.user` when a valid token is present, and say nothing otherwise.
 *
 * Anonymous is the normal case, so the default path through here is "no user,
 * carry on".
 */
export async function attachUser(req, _res, next) {
  try {
    req.user = await verifyToken(bearer(req));
  } catch {
    req.user = null;
  }
  next();
}

/**
 * The gate for anything that touches an account or costs the operator money.
 *
 * `code` is what the client keys on to open its sign-in sheet, so it is part
 * of the contract rather than prose. A deploy with no Supabase project reports
 * that distinctly: "sign in" is useless advice when there is nowhere to sign
 * in to.
 */
export function requireUser(req, res, next) {
  if (req.user) return next();

  if (!configured()) {
    return res
      .status(503)
      .json({ error: 'Accounts are not set up on this server.', code: 'auth_unconfigured' });
  }
  return res.status(401).json({ error: 'Sign in to use this.', code: 'auth_required' });
}

/* ------------------------------------------------------------ sign-in flow */

/**
 * Sign-in is Google OAuth, and the browser drives it.
 *
 * ## Why not the emailed code this used to be
 *
 * A six-digit code needs Supabase's email template to render `{{ .Token }}`,
 * and editing templates requires paid custom SMTP. The built-in sender is also
 * rate-limited to a handful of messages an hour, which is not a sign-in
 * system. Google costs nothing on either side.
 *
 * ## What this gives up, honestly
 *
 * A redirect. Codes were chosen precisely to avoid one, because this app is
 * installed to a home screen and a redirect lands in a browser tab rather than
 * in the PWA. That is still true — but the tab and the PWA share an origin and
 * therefore share localStorage, so signing in via the tab leaves the installed
 * app signed in. Slightly awkward, not broken.
 *
 * ## What is left on the server
 *
 * Less than before, deliberately. OAuth requires the user to interact with
 * Google, so the authorize step cannot be proxied — the browser navigates
 * there itself and comes back with tokens in the URL fragment. What stays here
 * is the part that must: verifying a bearer token, and trading a refresh token
 * for a new session. The endpoints that sent email are gone, because an
 * unauthenticated route that makes a third party send mail to any address is a
 * spam relay once nothing in the UI uses it.
 */

/** Where the browser must navigate to start Google sign-in. */
export function authorizeUrl(redirectTo) {
  if (!configured()) return '';
  const target = encodeURIComponent(redirectTo);
  return `${SUPA_URL}/auth/v1/authorize?provider=google&redirect_to=${target}`;
}

/** Trade a refresh token for a fresh session. */
export async function refreshSession(refreshToken) {
  return post('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
}

/**
 * One shape for every call to the identity provider.
 *
 * Upstream messages are passed through rather than replaced: "Refresh token is
 * not valid" is something the caller can act on, and flattening it into
 * "sign-in failed" would remove the only useful information in the response.
 */
async function post(path, body) {
  if (!configured()) {
    throw new AuthError('Accounts are not set up on this server.', 503);
  }

  let response;
  try {
    response = await fetch(`${SUPA_URL}${path}`, {
      method: 'POST',
      headers: { apikey: SUPA_ANON, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AuthError(`Could not reach the sign-in service: ${error?.message ?? 'unknown'}`, 502);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error_description ?? payload?.msg ?? payload?.message ?? `Sign-in failed (${response.status}).`;

    /*
     * A 4xx from the identity provider is about the request, so it is passed
     * through as itself; only a genuine upstream failure becomes 502.
     *
     * This was `status === 400 ? 400 : 502`, which was wrong against the real
     * service: Supabase answers a stale token with 403, so those were reported
     * as bad gateways and a rate-limit 429 was flattened the same way.
     */
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new AuthError(String(message), status);
  }

  return payload ?? {};
}

export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Public configuration for the client.
 *
 * The URL is needed now: OAuth is a navigation the browser performs itself, so
 * it has to know where to go. The anon key still stays here — the authorize
 * endpoint does not need it, and the only calls that do are made server-side.
 * There is no service-role key anywhere in this app, and nothing here should
 * ever become the place one gets added.
 */
export function info() {
  return { configured: configured(), url: SUPA_URL };
}
