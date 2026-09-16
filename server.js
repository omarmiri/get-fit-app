/**
 * Server for the built app.
 *
 * The browser is still the source of truth: everything works with no account,
 * and a signed-out user's training never leaves their device. What this server
 * adds is optional — a per-account backup, so clearing a browser is not the
 * end of a training history.
 *
 * No plan is written here. Plans come from whichever LLM the user prefers, and
 * arrive either pasted into the app or pushed to a session by that LLM. This
 * process never sees the health context that produced them.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

import { AccountError, loadState, saveState } from './account.js';
import * as auth from './auth.js';
import { lastHeartbeat, startKeepAlive, startSupabaseHeartbeat } from './keepalive.js';
import { DropError, createSession, pushPlan, readSession } from './sessions.js';

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
        // Same-origin only: the app has no third-party API to reach.
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

app.get('/health', async (_req, res) => {
  const identity = auth.info();
  /*
   * Asked of Supabase, not assumed. "Configured" and "can actually sign
   * someone in" are different claims, and a project with Google switched off
   * satisfies the first while failing the second — silently, which is the
   * expensive way for this to be wrong. `null` means the probe could not
   * answer, which is distinct from "none enabled".
   */
  const providers = await auth.enabledProviders();

  res.json({
    ok: true,
    uptime: process.uptime(),
    /*
     * The URL is public and the browser needs it: the OAuth step is a
     * navigation it performs itself. The anon key is not included — the
     * authorize endpoint does not need it, and every call that does is made
     * from this process.
     */
    auth: { configured: identity.configured, url: identity.url, providers },
    /*
     * The last Supabase beat, so a keep-alive that is silently not working is
     * observable now rather than inferred from the project being paused a week
     * from now. `null` means none has run yet this process.
     */
    heartbeat: lastHeartbeat(),
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

// A pushed plan is bigger than a default form post but nowhere near the 100kb
// default cap.
app.use('/api', express.json({ limit: '256kb' }));

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

/* ------------------------------------------------------------------ drops */

/*
 * How a plan written elsewhere gets here. The reasoning behind the two ids
 * lives in `sessions.js`; what follows is only the HTTP shape of it.
 */

/** Open a session. Anonymous — a drop needs no account. */
app.post('/api/sessions', async (_req, res) => {
  try {
    return res.status(201).json(await createSession());
  } catch (error) {
    console.error(`[drop] create failed: ${error?.message ?? 'unknown'}`);
    return res.status(502).json({ error: 'Could not open a session.' });
  }
});

/**
 * The public write endpoint: where someone else's LLM puts the finished plan.
 *
 * Unauthenticated by design. The push id in the URL is the capability, and it
 * only ever grants writing — see the note on the two ids in `sessions.js`.
 *
 * CORS is open because the caller may be a browser-based tool rather than a
 * server, and closing it would buy nothing: the id, not the origin, is what
 * authorises the write, and a caller that already has the id is not stopped by
 * a preflight.
 */
app.options('/api/sessions/:pushId/plans', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  });
  res.status(204).end();
});

app.post('/api/sessions/:pushId/plans', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  try {
    const result = await pushPlan(req.params.pushId, req.body);
    /*
     * The response talks to a language model, so it says what happened in
     * terms the model can use on its next turn rather than just `ok: true`.
     */
    return res.status(201).json({
      ok: true,
      ...result,
      message: `Plan received as version ${result.version}. It is waiting in the app for review.`,
    });
  } catch (error) {
    if (error instanceof DropError) {
      // Deliberately verbose: a rejected push is the one moment a model can
      // fix its own output, and it can only do that if told what was wrong.
      return res.status(error.status).json({ ok: false, error: error.message, code: error.code });
    }
    console.error(`[drop] push failed: ${error?.message ?? 'unknown'}`);
    return res.status(502).json({ ok: false, error: 'Could not store that plan.' });
  }
});

/**
 * What the waiting device polls.
 *
 * The poll token goes in the Authorization header rather than the query
 * string, so it stays out of access logs and out of any Referer this app's own
 * navigations might produce.
 */
app.get('/api/sessions/:pushId', async (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  try {
    return res.json(await readSession(req.params.pushId, token));
  } catch (error) {
    if (error instanceof DropError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error(`[drop] read failed: ${error?.message ?? 'unknown'}`);
    return res.status(502).json({ error: 'Could not read that session.' });
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

/*
 * Supabase pauses a free project after about a week of inactivity, and this
 * app would otherwise give it none: identity is all it is used for, and every
 * training record lives in Upstash. Restarts are the schedule here — see the
 * note in keepalive.js.
 */
const stopHeartbeat = startSupabaseHeartbeat(
  Object.assign({ anonKey: process.env.SUPABASE_ANON_KEY ?? '' }, auth.info()),
);

// Render sends SIGTERM on deploy and on scale-down; closing cleanly avoids
// dropping in-flight responses.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopKeepAlive?.();
    stopHeartbeat?.();
    server.close(() => process.exit(0));
  });
}
