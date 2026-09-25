/**
 * Per-account storage of the app's state blob.
 *
 * ## Stored, not merged
 *
 * The server keeps the latest copy and has no opinion about it. Merging is the
 * client's job (`src/state/merge.ts`), because the client owns the schema and
 * knows what changed since it last synced.
 *
 * What the server does guarantee is that no write is lost to a race. A client
 * says which `updatedAt` it merged against, and a write is refused with 409 if
 * another device has written since — so the loser pulls, merges and retries
 * rather than quietly overwriting a session logged on the other phone.
 *
 * ## What is not here
 *
 * Health context. It is per-session input on the client and never reaches
 * persisted state, so there is nothing to store — see `state/ephemeral.ts`.
 */

import { gunzipSync, gzipSync } from 'node:zlib';

import { KvConflict, kvGet, kvSet, kvSetIf } from './kv.js';

const stateKey = (uid) => `fit:state:${uid}`;

/**
 * Cap on a history as the client sends it.
 *
 * A long training history is genuinely large — a year of four sessions a week
 * is about half a megabyte of JSON — so this is generous: several years. It
 * exists because an account is a place someone else's client writes to, and
 * "as much as you like" is not a size. Kept under the 4mb body limit on the
 * route in server.js.
 */
export const MAX_STATE_BYTES = 3.5 * 1024 * 1024;

/**
 * Cap on the stored, compressed copy.
 *
 * DynamoDB refuses any item over 400KB, key and attributes included. The
 * history used to be stored as plain JSON and crossed that in about a year of
 * regular training, after which every sync failed — silently, as sync is
 * designed to. Gzipped it is about fifteen times smaller, so the 400KB wall is
 * decades away for a real history; this margin keeps the item itself legal.
 */
const MAX_STORED_BYTES = 380 * 1024;

/**
 * The stored history for an account as `{ state, updatedAt }`, or `null`.
 *
 * Records written before compression hold `state` as plain JSON and are read
 * as they are; each is rewritten compressed on its next save.
 */
export async function loadState(uid) {
  const record = await kvGet(stateKey(uid));
  if (!record || typeof record !== 'object') return null;

  if (record.stateGz) {
    const state = JSON.parse(gunzipSync(Buffer.from(record.stateGz)).toString('utf8'));
    return { state, updatedAt: record.updatedAt ?? null };
  }
  return { state: record.state ?? null, updatedAt: record.updatedAt ?? null };
}

/**
 * Replace an account's stored blob. Returns the new `updatedAt`.
 *
 * The state is written as given, not merged and not validated field by field:
 * the client owns the schema and runs a total parser over it on the way back
 * in, so a server-side copy of those rules would be a second thing to keep in
 * step. What the server does enforce is size, that the thing is an object,
 * and — when `baseUpdatedAt` is given — that nobody else wrote in between.
 *
 * `baseUpdatedAt` of `undefined` is an unconditional write, which is what a
 * client from before sync still sends until its service worker updates.
 */
export async function saveState(uid, state, baseUpdatedAt) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new AccountError('That is not an app state.', 400);
  }

  const serialized = JSON.stringify(state);
  if (serialized.length > MAX_STATE_BYTES) {
    throw new AccountError('That backup is too large to store.', 413);
  }

  // Compression also cuts the write cost by the same factor: DynamoDB bills a
  // write per kilobyte of the item, and every sync rewrites the whole history.
  const stateGz = gzipSync(serialized);
  if (stateGz.length > MAX_STORED_BYTES) {
    throw new AccountError('That backup is too large to store.', 413);
  }

  // Strictly after the version it replaces, even within one millisecond, or a
  // stale base could match the new version and slip past the check.
  const record = { stateGz, updatedAt: Math.max(Date.now(), (baseUpdatedAt ?? 0) + 1) };

  if (baseUpdatedAt === undefined) {
    await kvSet(stateKey(uid), record);
    return record.updatedAt;
  }

  try {
    await kvSetIf(stateKey(uid), record, 'updatedAt', baseUpdatedAt);
  } catch (error) {
    if (error instanceof KvConflict) {
      throw new AccountError('Another device saved first. Sync again.', 409);
    }
    throw error;
  }
  return record.updatedAt;
}

export class AccountError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
  }
}
