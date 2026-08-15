import type { AppState } from '@/types';
import { currentUser, pushState } from './account';

/**
 * Keeping the account's copy roughly current, without getting in the way.
 *
 * ## Why this is quiet
 *
 * The backup is a convenience, not the source of truth. The device already has
 * the data and already persisted it to localStorage before this runs. So every
 * failure here is survivable and none of them is worth a dialog: no network in
 * the gym is the expected case, not an error state.
 *
 * A failed push is retried on the next change rather than immediately. There is
 * no queue and no exponential backoff because there is nothing to catch up on —
 * the payload is the *whole* state every time, so the next successful push
 * subsumes every failed one before it.
 *
 * ## Why it is slow
 *
 * Logging a set commits state, and a set gets logged every ninety seconds all
 * session. Pushing on each one would be a request per set for no benefit, since
 * only the last one's contents survive anyway. A long debounce means a session
 * usually costs one push, at the end, when the user has stopped tapping.
 */

/** Long enough that a working set does not trigger its own upload. */
const QUIET_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: AppState | null = null;
let inFlight = false;

/** Note that state changed. Pushes once things go quiet. */
export function backUpSoon(state: AppState): void {
  if (!currentUser()) return;

  pending = state;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flush(), QUIET_MS);
}

/**
 * Push now if anything is pending.
 *
 * Exported for the page-hide path: a phone closing the app is exactly when the
 * debounce has not fired yet and the data most needs to leave.
 */
export async function flushBackup(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}

async function flush(): Promise<void> {
  timer = null;

  // One at a time. A second push while the first is still going would race,
  // and whichever landed last would win regardless of which was newer.
  if (inFlight || !pending || !currentUser()) return;

  const state = pending;
  pending = null;
  inFlight = true;

  try {
    await pushState(state);
  } catch {
    /*
     * Silent by design. Offline is the normal case in a gym, the data is
     * already safe on the device, and the next change re-arms this with a
     * newer payload that supersedes this one entirely.
     */
    pending = state;
  } finally {
    inFlight = false;
  }
}
