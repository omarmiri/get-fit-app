/**
 * Server for the built app.
 *
 * The browser is still the source of truth: everything works with no account,
 * and a signed-out user's training never leaves their device. What this server
 * adds is optional — a Gemini proxy so the API key never reaches a client, and
 * a per-account backup so clearing a browser is not the end of a training
 * history.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

import { AccountError, loadState, meterPlanGeneration, saveState } from './account.js';
import * as auth from './auth.js';
import { GeminiError, generatePlan } from './gemini.js';
import { startKeepAlive } from './keepalive.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, 'dist');
const indexFile = path.join(distDir, 'index.html');
const port = Number(process.env.PORT) || 3000;

if (!existsSync(indexFile)) {
  console.error(`No build found at ${distDir}. Run "npm run build" first.`);
  process.exit(1);
}

const app = express();

// Render terminates TLS upstream; trusting its proxy makes req.secure and the
// client IP accurate for redirects and logging.
app.set('trust proxy', 1);
app.disable('x-powered-by');

/**
 * The app loads no third-party resources — fonts are bundled and all data is
 * local — so the policy can be strict. `'unsafe-inline'` is allowed for styles
 * only, because element-level `style` attributes set the plate accent colours.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'font-src': ["'self'"],
        // Same-origin only: the Gemini call goes through this server, so the
        // browser never talks to a third-party API directly.
        'connect-src': ["'self'"],
        'manifest-src': ["'self'"],
        'worker-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    // Same-origin is enough here and avoids breaking the installed PWA context.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

app.use(compression());

app.get('/health', (_req, res) => {
  const identity = auth.info();

  res.json({
    ok: true,
    uptime: process.uptime(),
    // Lets the client hide the generate control rather than offering a button
    // that can only fail. Reports presence, never the key itself.
    gemini: Boolean(process.env.GEMINI_API_KEY),
    /*
     * The URL is public and the browser needs it: the OAuth step is a
     * navigation it performs itself. The anon key is not included — the
     * authorize endpoint does not need it, and every call that does is made
     * from this process.
     */
    auth: { configured: identity.configured, url: identity.url },
  });
});

/* --------------------------------------------------------------- plan API */

/*
 * A backup is a whole training history and is much larger than anything else
 * this API accepts, so it gets its own limit — mounted first, because the
 * general parser below would otherwise reach the body first and reject it at
 * 256kb. `express.json` is a no-op once a body is parsed, so the second mount
 * simply passes it through.
 */
app.use('/api/account/state', express.json({ limit: '4mb' }));

// Plan requests carry the exercise and station catalogues, so the body is
// larger than a default form post but nowhere near the 100kb default cap.
app.use('/api', express.json({ limit: '256kb' }));

/**
 * Coarse per-IP rate limit, in front of the per-account quota.
 *
 * This is not the thing that protects the Gemini key — `meterPlanGeneration`
 * is, and it counts against an account rather than an address. This is only
 * here to blunt an unauthenticated flood before it reaches the identity
 * provider. In-memory state is fine: a restart resetting the window costs
 * nothing.
 */
const RATE_LIMIT = { windowMs: 60_000, max: 10 };
const requestLog = new Map();

function rateLimited(key) {
  const now = Date.now();
  const hits = (requestLog.get(key) ?? []).filter((at) => now - at < RATE_LIMIT.windowMs);
  hits.push(now);
  requestLog.set(key, hits);

  // Bound the map so a long-running process cannot accumulate stale keys.
  if (requestLog.size > 100) {
    for (const [existing, times] of requestLog) {
      if (times.every((at) => now - at >= RATE_LIMIT.windowMs)) requestLog.delete(existing);
    }
  }

  return hits.length > RATE_LIMIT.max;
}

/* ------------------------------------------------------------- accounts */

/**
 * Sign-in is Google OAuth, so most of it does not happen here.
 *
 * The browser navigates to Supabase's authorize endpoint itself and comes back
 * with tokens in the URL fragment — that step needs the user to interact with
 * Google and therefore cannot be proxied. What remains on this server is the
 * part that must be: verifying bearer tokens, and refreshing a session.
 *
 * The endpoints that emailed a sign-in code were removed with that flow. An
 * unauthenticated route that makes a third party send mail to an arbitrary
 * address is a spam relay the moment nothing in the UI needs it.
 */
app.post('/api/auth/refresh', async (req, res) => {
  const token = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
  if (!token) return res.status(400).json({ error: 'No refresh token.' });

  try {
    const session = await auth.refreshSession(token);
    return res.json(sessionResponse(session));
  } catch (error) {
    return res
      .status(error instanceof auth.AuthError ? error.status : 502)
      .json({ error: error?.message ?? 'Could not refresh the session.' });
  }
});

/**
 * Narrow a Supabase session to what the client needs.
 *
 * Passing the upstream body through wholesale would hand the browser fields it
 * has no use for and would couple this app's contract to whatever Supabase
 * adds next.
 */
function sessionResponse(session) {
  return {
    accessToken: session?.access_token ?? '',
    refreshToken: session?.refresh_token ?? '',
    expiresIn: session?.expires_in ?? 3600,
    user: session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null,
  };
}

/**
 * Who the caller is, if anyone.
 *
 * Anonymous is a normal answer, not an error — the app works with no account
 * and that is the point. The client uses this to decide whether to offer a
 * backup, not whether to let anyone train.
 */
app.get('/api/account/me', auth.attachUser, (req, res) => {
  res.json({ user: req.user ?? null });
});

/**
 * The account's stored state, or `null` when there is none yet.
 *
 * A first sign-in on a new device answers `null`, which the client reads as
 * "keep what is here and push it", rather than as an instruction to wipe.
 */
app.get('/api/account/state', auth.attachUser, auth.requireUser, async (req, res) => {
  try {
    const record = await loadState(req.user.id);
    return res.json({ state: record?.state ?? null, updatedAt: record?.updatedAt ?? null });
  } catch (error) {
    console.error(`[account] load failed: ${error?.message ?? 'unknown'}`);
    return res.status(502).json({ error: 'Could not reach your backup.' });
  }
});

/** Replace the account's stored state with the client's copy. */
app.put('/api/account/state', auth.attachUser, auth.requireUser, async (req, res) => {
  try {
    await saveState(req.user.id, req.body?.state);
    return res.json({ ok: true, updatedAt: Date.now() });
  } catch (error) {
    if (error instanceof AccountError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(`[account] save failed: ${error?.message ?? 'unknown'}`);
    return res.status(502).json({ error: 'Could not save to your backup.' });
  }
});

app.post('/api/plan/generate', auth.attachUser, async (req, res) => {
  if (rateLimited(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many plan requests. Wait a minute and try again.' });
  }

  /*
   * Metering, once accounts exist.
   *
   * The IP limit below this was written when the app had one user and the risk
   * was an accidental loop rather than abuse. With sign-in that stopped being
   * true — the Gemini key is the operator's and the users are not — so a
   * signed-in caller is metered per account, and an anonymous one cannot spend
   * the key at all on a deploy that has accounts configured.
   */
  if (auth.configured()) {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'Sign in to generate a plan here, or write one with your own LLM.', code: 'auth_required' });
    }
    try {
      await meterPlanGeneration(req.user.id);
    } catch (error) {
      if (error instanceof AccountError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error(`[plan] metering failed: ${error?.message ?? 'unknown'}`);
      // A metering outage must not become a free-for-all on someone else's
      // quota, so this fails closed.
      return res.status(503).json({ error: 'Cannot check your plan allowance right now.' });
    }
  }

  /*
   * The request body carries health context, and this is the only place it
   * ever exists on a server. It is passed to Gemini, and then it is gone: not
   * stored, not cached, not written to a log. Nothing below logs the body or
   * an object that could contain it — an error's `message` is safe, an error
   * object is not necessarily, so only the message is printed.
   */
  try {
    const { plan, model } = await generatePlan(req.body ?? {});
    return res.json({ plan, model });
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error(`[plan] ${error.status}: ${error.message}`);
      return res.status(error.status).json({ error: error.message });
    }
    console.error(`[plan] unexpected failure: ${error?.message ?? 'unknown'}`);
    return res.status(500).json({ error: 'Plan generation failed unexpectedly.' });
  }
});

/**
 * Vite fingerprints everything under `/assets`, so those files are immutable and
 * can be cached hard. Everything else — the HTML shell, the service worker, the
 * manifest, the icons — must revalidate, or a deployed fix would never reach a
 * phone that already has the old copy.
 */
app.use(
  express.static(distDir, {
    index: 'index.html',
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      const relative = path.relative(distDir, filePath).replace(/\\/g, '/');

      if (relative.startsWith('assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

/**
 * SPA fallback, scoped to navigations.
 *
 * The previous version returned `index.html` for every unmatched path, so a
 * missing script or icon answered 200 with a page of HTML — which turns a
 * simple 404 into a confusing parse error. Requests that look like assets get a
 * real 404 instead.
 */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (path.extname(req.path) !== '') return next();
  if (!(req.headers.accept ?? '').includes('text/html')) return next();

  res.setHeader('Cache-Control', 'no-cache');
  return res.sendFile(indexFile);
});

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

const server = app.listen(port, () => {
  console.log(`Rack & File listening on :${port}`);
});

// Keeps a warm instance warm during waking hours. Cannot wake a cold one — the
// external cron in .github/workflows/keepalive.yml does that.
const stopKeepAlive = startKeepAlive();

// Render sends SIGTERM on deploy and on scale-down; closing cleanly avoids
// dropping in-flight responses.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopKeepAlive?.();
    server.close(() => process.exit(0));
  });
}
