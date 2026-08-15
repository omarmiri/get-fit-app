/**
 * Accounts: Supabase as identity provider, nothing more.
 *
 * Ported from `local-atlas/auth.js`, which arrived at this shape for good
 * reasons that apply here too. Differences are noted where they exist.
 *
 * ## What Supabase owns, and what it does not
 *
 * It owns the email flow, the one-time-code handling and session refresh. It
 * does NOT own training data: sessions, plans and preferences live in
 * `store.js` next to everything else durable this app keeps. Running a second
 * database for one JSON blob per user would buy a second thing to operate and
 * a second thing to be down.
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
 * The anon key is designed to be public — it ships to the browser and is
 * useless without a user token. It is read here so the client can be handed it
 * from /health rather than having a deploy-specific value pasted into version
 * control.
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
 * Sign-in is proxied, not called from the browser.
 *
 * `local-atlas` calls Supabase's auth REST API directly from the page, which
 * is reasonable for an app that already loads third-party scripts. This one
 * loads nothing from anywhere and holds `connect-src 'self'`, and giving that
 * up for sign-in would be the single biggest hole punched in the policy. So
 * the three calls the flow needs go through this server instead.
 *
 * Two things fall out of that, both good. The anon key never reaches the
 * browser — it is not secret, but not shipping it is strictly better — and the
 * CSP stays exactly as strict as it was before accounts existed.
 *
 * The flow is a six-digit emailed code rather than a magic link. A link has to
 * redirect back into the app, and this app is installed to a home screen where
 * that round-trip lands in a browser tab rather than in the PWA. A code is
 * typed where the user already is.
 */

/** Ask Supabase to email a sign-in code. */
export async function requestCode(email) {
  return post('/auth/v1/otp', { email, create_user: true });
}

/** Exchange an emailed code for a session. */
export async function verifyCode(email, token) {
  return post('/auth/v1/verify', { email, token, type: 'email' });
}

/** Trade a refresh token for a fresh session. */
export async function refreshSession(refreshToken) {
  return post('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
}

/**
 * One shape for every call to the identity provider.
 *
 * Upstream messages are passed through rather than replaced: "Email rate limit
 * exceeded" and "Token has expired or is invalid" are both things the user can
 * act on, and flattening them into "sign-in failed" would remove the only
 * useful information in the response.
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
    throw new AuthError(String(message), response.status === 400 ? 400 : 502);
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
 * Deliberately only whether accounts exist. The anon key stays on the server
 * because every call that needs it is proxied. There is no service-role key
 * anywhere in this app, and nothing here should ever become the place one gets
 * added.
 */
export function info() {
  return { configured: configured() };
}
