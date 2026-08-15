/**
 * Per-account storage of the app's state blob, and per-account metering.
 *
 * ## Backup and restore, not sync
 *
 * The client remains the source of truth. It pushes its whole `AppState` after
 * changes and pulls it on sign-in; the server keeps the latest copy and has no
 * opinion about it. There is no merge, because multi-device was explicitly out
 * of scope — with one device, last-write-wins is not a compromise, it is
 * simply correct.
 *
 * If two devices ever do run at once, the loser's writes are lost, and that
 * would be the moment to build real sync rather than to quietly hope. The
 * `updatedAt` written alongside each blob is what a future version would need
 * to detect it, which is why it is recorded now.
 *
 * ## What is not here
 *
 * Health context. It is per-session input on the client and never reaches
 * persisted state, so there is nothing to store — see `state/ephemeral.ts`.
 */

import { kvGet, kvIncrement, kvSet } from './kv.js';

const stateKey = (uid) => `fit:state:${uid}`;
const quotaKey = (uid) => `fit:quota:plan:${uid}`;

/**
 * Cap on a stored blob.
 *
 * A long training history is genuinely large — years of sets — so this is
 * generous. It exists because an account is a place someone else's client
 * writes to, and "as much as you like" is not a size.
 */
export const MAX_STATE_BYTES = 2 * 1024 * 1024;

/**
 * Plan generations allowed per account per day.
 *
 * The old IP-based limit existed because "the concern is not abuse but an
 * accidental loop". With accounts that stops being true: the key is the
 * operator's and the users are not all the operator. This is the meter that
 * replaces trust.
 */
export const PLAN_QUOTA = { max: 20, windowMs: 24 * 60 * 60 * 1000 };

/** The stored blob for an account, or `null` if there is none yet. */
export async function loadState(uid) {
  const record = await kvGet(stateKey(uid));
  if (!record || typeof record !== 'object') return null;
  return record;
}

/**
 * Replace an account's stored blob.
 *
 * The state is written as given, not merged and not validated field by field:
 * the client owns the schema and runs a total parser over it on the way back
 * in, so a server-side copy of those rules would be a second thing to keep in
 * step. What the server does enforce is size, and that the thing is an object.
 */
export async function saveState(uid, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new AccountError('That is not an app state.', 400);
  }

  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES) {
    throw new AccountError('That backup is too large to store.', 413);
  }

  await kvSet(stateKey(uid), { state, updatedAt: Date.now() });
}

/**
 * Count one plan generation against an account's daily allowance.
 *
 * Throws when the allowance is spent. Counted before the call to Gemini rather
 * than after: a failed generation still costs a request upstream, and metering
 * only successes is how a retry loop bills the operator for a thousand errors.
 */
export async function meterPlanGeneration(uid) {
  const used = await kvIncrement(quotaKey(uid), PLAN_QUOTA.windowMs);
  if (used > PLAN_QUOTA.max) {
    throw new AccountError(
      `That is ${PLAN_QUOTA.max} plans today, which is the daily limit. Write one with your own LLM in the meantime — the app takes those too.`,
      429,
    );
  }
  return { used, remaining: Math.max(0, PLAN_QUOTA.max - used) };
}

export class AccountError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
  }
}
