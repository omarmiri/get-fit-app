/**
 * Server for the built app.
 *
 * Training data still lives entirely in the browser — there is no database and
 * nothing about a session is stored here. The only server-side logic is the
 * Gemini plan proxy, which exists solely so the API key never reaches a client.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

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
  res.json({
    ok: true,
    uptime: process.uptime(),
    // Lets the client hide the generate control rather than offering a button
    // that can only fail. Reports presence, never the key itself.
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
});

/* --------------------------------------------------------------- plan API */

// Plan requests carry the exercise and station catalogues, so the body is
// larger than a default form post but nowhere near the 100kb default cap.
app.use('/api', express.json({ limit: '256kb' }));

/**
 * Crude fixed-window rate limit.
 *
 * This is a single-user app, so the concern is not abuse but an accidental
 * loop burning through quota. In-memory state is fine: a restart resetting the
 * window costs nothing.
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

app.post('/api/plan/generate', async (req, res) => {
  if (rateLimited(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: 'Too many plan requests. Wait a minute and try again.' });
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
