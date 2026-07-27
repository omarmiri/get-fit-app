/**
 * Static server for the built app.
 *
 * There is no database and no API — the app keeps everything in the browser.
 * This process exists only to hand out `dist/` on Render with correct caching
 * and sensible security headers.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

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
        // Blob URLs back the backup export download.
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
  res.json({ ok: true, uptime: process.uptime() });
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

// Render sends SIGTERM on deploy and on scale-down; closing cleanly avoids
// dropping in-flight responses.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
