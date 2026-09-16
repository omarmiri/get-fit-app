/**
 * Keeping the Supabase project from being paused for inactivity.
 *
 * ## What used to be here
 *
 * A self-ping that held a Render free instance awake between 8am and 8pm New
 * York time, plus a GitHub Actions cron that woke it from outside — the
 * in-process half could hold a warm instance warm but could never wake a cold
 * one, because the process doing the pinging was the process that was asleep.
 *
 * Both are gone. The app is moving to Lambda, which has no spin-down to work
 * around: a cold start is under a second rather than the better part of a
 * minute, and there is no instance-hour allowance to ration a waking window
 * against. The Actions workflow went with it — it had been failing against a
 * service that was already down, which is an alert about nothing.
 */

/**
 * Keeping the Supabase project from being paused for inactivity.
 *
 * ## Why this app needs it more than most
 *
 * Supabase pauses a free project after about a week with no activity. Most
 * apps never notice, because the app itself is constantly querying. This one
 * uses Supabase for identity and nothing else — every session, plan and
 * preference lives in the record store — so with no users signing in, the
 * Supabase database sees no traffic at all. Not a little: none.
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
