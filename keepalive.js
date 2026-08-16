/**
 * Keeping the Render free instance awake during waking hours.
 *
 * ## The problem
 *
 * Render spins a free web service down after ~15 minutes without inbound
 * traffic, and the next request then waits ~50 seconds for a cold start.
 *
 * For loading the app this barely matters — the service worker precaches the
 * shell, so it opens from cache with no network at all. Where it does hurt is
 * `/api/plan/generate`, which has to reach this server, so the first plan
 * generation after an idle period eats the whole cold start.
 *
 * ## Why the window
 *
 * Free instance hours are capped at 750/month and a month is ~730 hours, so
 * staying awake around the clock would consume essentially the entire
 * allowance and leave no room for a second service. Holding the service up
 * only between 8am and 8pm New York time costs roughly 395 hours a month, and
 * nobody is training at 4am anyway.
 *
 * ## Why this is only half the answer
 *
 * A self-ping keeps the service warm *while it is already running*. It cannot
 * wake a service that has already gone to sleep, because the process doing the
 * pinging is the process that is asleep. After every overnight idle period —
 * and after any deploy or crash — it stays down until something external
 * knocks.
 *
 * That is what `.github/workflows/keepalive.yml` is for: an external cron that
 * can wake a cold service. This module is the belt to that pair of braces, and
 * some reports suggest Render may discount traffic a service sends to itself,
 * so treat the external cron as the one that actually matters.
 */

/** Comfortably inside Render's ~15 minute idle window. */
const PING_INTERVAL_MS = 10 * 60 * 1000;

/** A ping that hangs should be abandoned, not left to pile up. */
const PING_TIMEOUT_MS = 15_000;

const TIME_ZONE = 'America/New_York';

/**
 * Awake window, as New York clock hours, both ends inclusive.
 *
 * Inclusive of hour 20 so a session starting at 8pm still finds the service
 * warm rather than cold-starting mid-workout.
 */
const WAKE_HOUR = 8;
const SLEEP_HOUR = 20;

/**
 * The hour of the day in New York, 0-23.
 *
 * Read through `Intl` rather than by applying a fixed offset, because New York
 * moves between EDT and EST twice a year and a hardcoded -5 would silently
 * shift the whole window by an hour for eight months of the year.
 */
export function newYorkHour(now = new Date()) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour: 'numeric',
    // h23 rather than hour12:false — the latter reports midnight as 24 under
    // some ICU builds.
    hourCycle: 'h23',
  }).format(now);

  return Number(formatted);
}

/** Whether the service should be held awake at this moment. */
export function isWithinWakeWindow(now = new Date()) {
  const hour = newYorkHour(now);
  return hour >= WAKE_HOUR && hour <= SLEEP_HOUR;
}

/**
 * Start pinging this service's own public URL during waking hours.
 *
 * No-ops unless `RENDER_EXTERNAL_URL` is set, so local development and tests
 * never make outbound requests. Set `KEEP_ALIVE=false` to turn it off — worth
 * doing on a paid instance, where it is pure waste.
 *
 * Returns a stop function, or `null` when keep-alive is not active.
 */
export function startKeepAlive({ log = console.log } = {}) {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;

  if (!baseUrl) return null;
  if (process.env.KEEP_ALIVE === 'false') {
    log('[keepalive] disabled by KEEP_ALIVE=false');
    return null;
  }

  const target = new URL('/health', baseUrl).toString();
  log(
    `[keepalive] ${target} every ${PING_INTERVAL_MS / 60000} min, ` +
      `${WAKE_HOUR}:00-${SLEEP_HOUR}:59 ${TIME_ZONE}`,
  );

  const ping = async () => {
    // Outside the window, let it sleep — that is the point of the window.
    if (!isWithinWakeWindow()) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const response = await fetch(target, {
        signal: controller.signal,
        headers: { 'user-agent': 'rackfile-keepalive' },
        cache: 'no-store',
      });
      if (!response.ok) log(`[keepalive] unexpected status ${response.status}`);
    } catch (error) {
      // A failed ping is not worth crashing over — the next one is 10 minutes
      // away, and the external cron is the real safety net.
      log(`[keepalive] ping failed: ${error?.message ?? 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  };

  const timer = setInterval(() => void ping(), PING_INTERVAL_MS);
  // Do not hold the event loop open on shutdown.
  timer.unref?.();

  return () => clearInterval(timer);
}

/* ------------------------------------------------------------- Supabase */

/**
 * Keeping the Supabase project from being paused for inactivity.
 *
 * ## Why this app needs it more than most
 *
 * Supabase pauses a free project after about a week with no activity. Most
 * apps never notice, because the app itself is constantly querying. This one
 * uses Supabase for identity and nothing else — every session, plan and
 * preference lives in Upstash — so with no users signing in, the Supabase
 * database sees no traffic at all. Not a little: none.
 *
 * The failure is quiet, which is what makes it worth pre-empting. A paused
 * project does not make the app look broken; the account card still renders
 * and sign-in simply stops working, and unpausing is a manual visit to a
 * dashboard nobody is watching.
 *
 * ## Why on startup rather than on a long timer
 *
 * A once-a-week interval would almost never fire. This process is not
 * long-lived: Render spins the free instance down overnight and restarts it on
 * every deploy, so a timer measured in days would be reset before reaching
 * zero. Beating once at startup turns the frequent restarts into the schedule,
 * and the slow interval below only matters if the process does stay up.
 *
 * The first beat is almost immediate — a few seconds, just enough to let the
 * server finish binding its port. An earlier version waited ten minutes to stay
 * clear of the cold-start rush, which was the wrong trade: this instance spins
 * down after about fifteen minutes idle, so a process that lived briefly would
 * never beat at all, and a keep-alive that quietly does not run is worse than
 * none. One small POST during startup costs nothing worth protecting.
 */
const HEARTBEAT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 15_000;

/**
 * The last beat's outcome, so `/health` can report it.
 *
 * Without this the only evidence a heartbeat works is the project not being
 * paused a week later, which is not evidence anyone can act on. `status` is
 * `0` when the request never completed.
 */
let lastBeat = null;

export function lastHeartbeat() {
  return lastBeat;
}

/**
 * Start beating against the Supabase project.
 *
 * Calls a `beat()` function rather than writing to a table directly, so the
 * only thing the public anon key can do is bump one timestamp — see the SQL in
 * README. No-ops without a project configured, so local development and tests
 * make no outbound requests.
 *
 * Returns a stop function, or `null` when inactive.
 */
export function startSupabaseHeartbeat({ url, anonKey, log = console.log } = {}) {
  if (!url || !anonKey) return null;
  if (process.env.KEEP_ALIVE === 'false') return null;

  const target = `${url}/rest/v1/rpc/beat`;

  const beat = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

    try {
      const response = await fetch(target, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });

      lastBeat = { at: Date.now(), ok: response.ok, status: response.status };

      if (!response.ok) {
        /*
         * Worth saying out loud rather than swallowing. A 404 here means the
         * `beat` function was never created, which means the project is not
         * actually being kept alive — and the whole point of this is that the
         * consequence would otherwise be invisible for a week.
         */
        log(`[heartbeat] supabase returned ${response.status} — is the beat() function created?`);
      }
    } catch (error) {
      lastBeat = { at: Date.now(), ok: false, status: 0 };
      log(`[heartbeat] failed: ${error?.message ?? 'unknown error'}`);
    } finally {
      clearTimeout(timeout);
    }
  };

  const first = setTimeout(() => void beat(), HEARTBEAT_DELAY_MS);
  first.unref?.();

  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  log(
    `[heartbeat] supabase every ${HEARTBEAT_INTERVAL_MS / 3_600_000}h, first in ${HEARTBEAT_DELAY_MS / 1000}s`,
  );

  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
