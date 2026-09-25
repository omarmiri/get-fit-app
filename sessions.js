/**
 * Plan drops: how a plan written by someone else's LLM reaches this app.
 *
 * ## The problem this solves
 *
 * The app's premise is that you ask whichever LLM you already pay for to write
 * your training week. Until now the last step was manual — the model printed a
 * JSON file, and you selected it, copied it, came back, and pasted it. That
 * works, and it stays working, but it is the worst part of the flow and it is
 * the part that fails on a phone.
 *
 * A drop replaces it. The app mints a session, puts its push id into the
 * prompt it hands you, and whichever tool you paste that prompt into can POST
 * the finished plan straight back. The app is holding a screen open waiting
 * for it.
 *
 * ## Two ids, and why it is not one
 *
 * A session has a **push id** and a **poll token**, and they are not
 * interchangeable.
 *
 * The push id travels inside a prompt, into a third-party chat log, through
 * whatever retention that vendor applies. Treat it as public: it is a bearer
 * capability that can only ever *write*. The worst thing someone who learns
 * one can do is send you a training plan you did not ask for, which the app
 * shows you for review and you decline.
 *
 * The poll token never leaves the browser that created the session. Reading a
 * session requires it. That asymmetry is the whole security model, and it is
 * why `readSession` takes a token and `pushPlan` does not: a leaked push id
 * must not become a way to read what was pushed, because a plan is a
 * reasonable guess at what someone's body is doing.
 *
 * ## What is deliberately not stored
 *
 * The survey. Age, conditions, injuries and the rest are typed on the device,
 * used to build the prompt text, and never sent here — the prompt is assembled
 * client-side precisely so that this module never sees them. What comes back
 * is a plan, and `parsePortablePlan` constructs it from known fields, so a
 * model that decides to explain its reasoning by restating someone's medical
 * history has that dropped on the way in rather than filtered on the way out.
 */

import { parsePortablePlan } from './server-lib/planFormat.mjs';
import { kvGet, kvIncrement, kvSet } from './kv.js';

const sessionKey = (pushId) => `fit:drop:${pushId}`;
const pushRateKey = (pushId) => `fit:drop:rate:${pushId}`;

/**
 * How long a session accepts pushes.
 *
 * Long enough to cover the actual behaviour this supports: someone builds a
 * plan in the morning, trains on it, and comes back that evening to ask for a
 * revision. Short enough that a push id pasted into a chat log is not a
 * write handle onto someone's app a month from now.
 */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Plans one session will accept.
 *
 * Not one. "Change the plan, make Thursday easier" is the expected second act,
 * not an edge case, and a single-use id would send the user back to the app to
 * mint another one between every revision. Twenty is far more iterations than
 * anyone will use and still bounds what a leaked id can fill.
 */
export const MAX_PUSHES = 20;

/** Pushes per minute for one session, in front of the lifetime cap. */
const PUSH_RATE = { windowMs: 60_000, max: 6 };

/**
 * Cap on a single pushed plan.
 *
 * A plan is a week of training, not a training history — it is far smaller
 * than the backup blob in `account.js`, and the limit should say so rather
 * than inheriting that one's generosity.
 */
export const MAX_PLAN_BYTES = 128 * 1024;

export class DropError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'DropError';
    this.status = status;
    if (code) this.code = code;
  }
}

/**
 * Unguessable ids, in an alphabet a person can retype.
 *
 * Crockford base32 without the letters that turn into other letters on a
 * phone screen. The push id ends up inside a prompt, and a model that
 * transcribes it with one character wrong produces a 404 that neither the user
 * nor the model can diagnose — so the alphabet matters more here than the few
 * bits of entropy the exclusions cost.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomId(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/**
 * Formatted in two groups, because it is read off a screen and typed into a
 * chat window by a human often enough to matter. 10 characters is ~50 bits.
 */
function newPushId() {
  return `${randomId(5)}-${randomId(5)}`;
}

/**
 * Open a session and return both halves.
 *
 * The caller is responsible for keeping `pollToken` on the device and putting
 * only `pushId` into anything a model will see.
 */
export async function createSession() {
  const pushId = newPushId();
  // Never displayed, never transcribed — so it is long and unformatted.
  const pollToken = randomId(32);
  const now = Date.now();

  const record = {
    pollToken,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    plans: [],
  };

  await kvSet(sessionKey(pushId), record, SESSION_TTL_MS);

  return { pushId, pollToken, expiresAt: record.expiresAt };
}

/**
 * Accept a plan pushed by someone's LLM.
 *
 * Returns the parser's own error text on a bad plan rather than a generic
 * rejection, because the caller is a language model that can act on it. That
 * is the substantive advantage of a push over a paste: when a pasted plan
 * fails validation the user has to carry the message back to the chat window
 * themselves, and most do not — they give up. Here the model reads why it was
 * refused and fixes it in the same turn.
 */
export async function pushPlan(pushId, body) {
  if (typeof pushId !== 'string' || !pushId) {
    throw new DropError('No session id.', 400, 'bad_session');
  }

  const record = await kvGet(sessionKey(pushId));
  if (!record) {
    throw new DropError(
      'That session id is not open. It may have expired, in which case the app will show a new one.',
      404,
      'unknown_session',
    );
  }

  const hits = await kvIncrement(pushRateKey(pushId), PUSH_RATE.windowMs);
  if (hits > PUSH_RATE.max) {
    throw new DropError('Too many pushes to this session. Wait a minute.', 429, 'rate_limited');
  }

  if ((record.plans?.length ?? 0) >= MAX_PUSHES) {
    throw new DropError(
      `That session has taken its ${MAX_PUSHES} plans. Open the app for a fresh id.`,
      429,
      'session_full',
    );
  }

  /*
   * Size is checked before parsing, on the raw body. Parsing first would mean
   * doing the work before deciding whether the work was allowed.
   */
  const raw = body?.plan ?? body;
  if (JSON.stringify(raw ?? null).length > MAX_PLAN_BYTES) {
    throw new DropError('That plan is too large.', 413, 'too_large');
  }

  const parsed = parsePortablePlan(raw);
  if (!parsed.plan) {
    throw new DropError(parsed.error ?? 'That is not a plan this app can read.', 422, 'invalid_plan');
  }
  /*
   * Refused here rather than left for the device, because here the author is
   * still listening: the model that pushed it reads this error on its next
   * turn and can fill in what is missing. The device can only show the user a
   * plan they cannot adopt.
   */
  if (parsed.incomplete.length > 0) {
    throw new DropError(parsed.incomplete.join(' '), 422, 'incomplete_movement');
  }

  const version = (record.plans?.length ?? 0) + 1;
  const entry = {
    version,
    receivedAt: Date.now(),
    plan: parsed.plan,
  };

  /*
   * Read-modify-write, which is a lost update if two pushes land in the same
   * millisecond. Accepted: the writers here are one person's chat session
   * pushing revisions in sequence, and the cost of losing one is that a
   * revision does not appear and the model is asked again. A transaction would
   * be real work to buy nothing anyone would notice.
   */
  const plans = [...(record.plans ?? []), entry];
  const remaining = Math.max(0, record.expiresAt - Date.now());
  await kvSet(sessionKey(pushId), { ...record, plans }, remaining);

  return {
    version,
    accepted: plans.length,
    remaining: MAX_PUSHES - plans.length,
    // What the parser mended, so the model hears about it and does better next time.
    ...(parsed.corrections?.length ? { corrections: parsed.corrections } : {}),
  };
}

/**
 * Everything pushed to a session, for the device that opened it.
 *
 * The token comparison is the only thing standing between a push id and the
 * plans pushed to it, so a mismatch is a 404 rather than a 403 — there is no
 * reason to confirm to a caller holding a guessed id that it named something
 * real.
 */
export async function readSession(pushId, pollToken) {
  const record = await kvGet(sessionKey(pushId));
  if (!record || !pollToken || record.pollToken !== pollToken) {
    throw new DropError('No such session.', 404, 'unknown_session');
  }

  return {
    expiresAt: record.expiresAt,
    plans: record.plans ?? [],
  };
}
