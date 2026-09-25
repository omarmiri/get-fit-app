/**
 * Durable record store, on DynamoDB.
 *
 * Ported from `local-atlas/store.js` and then moved off Upstash when this app
 * moved to AWS. Two things about it are deliberate and worth keeping.
 *
 * ## Writes may have no expiry
 *
 * That app stored preferences and call records, all of which had a sensible
 * lifetime. This one stores a person's training history, which does not. A TTL
 * on that is a promise to delete someone's logbook on a date nobody chose, and
 * "it expired" is not a thing a training log gets to say. Plan drops are the
 * exception and pass an explicit TTL, because a push id that stays writable
 * forever is a liability rather than a feature.
 *
 * ## It falls back to memory
 *
 * With no table configured the store keeps everything in the process, so the
 * app runs — and the tests run — with no AWS account and no network. The
 * caveat is the one it has always had, and it got sharper with Lambda: a
 * restart loses it, and two concurrent instances do not share it. Fine for
 * local development, wrong for a deploy. `configured()` is how a caller can
 * tell which it is talking to.
 *
 * ## Why DynamoDB rather than Redis
 *
 * Expiry is the reason. Sessions need it, training history must not have it,
 * and DynamoDB expresses both as a per-item attribute rather than as a
 * property of the connection. It is also in-account — no second dashboard, no
 * shared secret to rotate, and IAM already says who may read it.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.DYNAMO_TABLE ?? '';

/** Local fallback. `expires` of `null` means no expiry. */
const memory = new Map();

export const configured = () => Boolean(TABLE);

/**
 * Built once per process, not per call.
 *
 * On Lambda the client is the expensive part of a cold start — it resolves
 * credentials and opens a connection pool — and every invocation after the
 * first reuses both.
 */
let client;
function docs() {
  client ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({}),
    // Undefined values are omitted rather than rejected, so a record with an
    // absent optional field writes cleanly instead of throwing.
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return client;
}

/**
 * DynamoDB's TTL attribute is epoch *seconds*, and everything else in this
 * codebase is milliseconds. Converting in one place keeps that mistake from
 * being made anywhere else.
 */
const toTtlSeconds = (expiresAtMs) => Math.ceil(expiresAtMs / 1000);

export async function kvGet(key) {
  if (!TABLE) {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expires !== null && hit.expires <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  }

  const { Item } = await docs().send(new GetCommand({ TableName: TABLE, Key: { pk: key } }));
  if (!Item) return null;

  /*
   * Expiry is checked here as well as by DynamoDB. TTL deletion is a
   * background sweep that can lag by up to 48 hours, so an expired item is
   * still readable for a while — and "still readable for a while" is not what
   * a session id that has expired is supposed to be.
   */
  if (typeof Item.ttl === 'number' && Item.ttl * 1000 <= Date.now()) return null;

  return Item.value ?? null;
}

/**
 * Write a record. Omit `ttlMs` — or pass `null` — for no expiry.
 */
export async function kvSet(key, value, ttlMs = null) {
  if (!TABLE) {
    memory.set(key, { value, expires: ttlMs === null ? null : Date.now() + ttlMs });
    return;
  }

  await docs().send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: key,
        value,
        ...(ttlMs === null ? {} : { ttl: toTtlSeconds(Date.now() + ttlMs) }),
      },
    }),
  );
}

/** Thrown by `kvSetIf` when the record changed since the caller last read it. */
export class KvConflict extends Error {
  constructor() {
    super('The record changed since it was read.');
    this.name = 'KvConflict';
  }
}

/**
 * Write a record only if its `value[field]` is still `expected`.
 *
 * `expected` of `null` means the record must not exist yet. This is what lets
 * two devices write the same account without either silently discarding the
 * other's changes: a writer that read a stale copy is refused, reads again,
 * merges, and retries. No expiry — every caller so far is durable state.
 */
export async function kvSetIf(key, value, field, expected) {
  if (!TABLE) {
    const current = await kvGet(key);
    const actual = current && typeof current === 'object' ? (current[field] ?? null) : null;
    if (actual !== expected) throw new KvConflict();
    memory.set(key, { value, expires: null });
    return;
  }

  try {
    await docs().send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk: key, value },
        ...(expected === null
          ? { ConditionExpression: 'attribute_not_exists(pk)' }
          : {
              ConditionExpression: '#value.#field = :expected',
              ExpressionAttributeNames: { '#value': 'value', '#field': field },
              ExpressionAttributeValues: { ':expected': expected },
            }),
      }),
    );
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') throw new KvConflict();
    throw error;
  }
}

/**
 * Remove a record.
 *
 * Deleting something already absent is a success, not an error — every caller
 * so far wants "make sure this is gone", and a single-use token being consumed
 * twice is a race to tolerate rather than a fault to report.
 */
export async function kvDelete(key) {
  if (!TABLE) {
    memory.delete(key);
    return;
  }

  await docs().send(new DeleteCommand({ TableName: TABLE, Key: { pk: key } }));
}

/**
 * Increment a counter that expires, for rate limiting.
 *
 * Returns the new value.
 *
 * ## Why the window is part of the key
 *
 * The obvious implementation — one item per counter, incremented, with the
 * expiry set only on first write — needs a read to tell a live counter from an
 * expired one that DynamoDB has not swept yet, and then cannot reset the
 * expiry anyway without a second write racing the first.
 *
 * Bucketing the key by window removes the problem rather than managing it.
 * Each window is a different item, so `ADD` is always correct on the item it
 * finds, `if_not_exists` always sets the right expiry, and the previous
 * window's item is simply garbage that DynamoDB collects on its own schedule —
 * whenever that happens to be, since nothing reads it again.
 *
 * One atomic call, no read, no race. It is a fixed window rather than a
 * sliding one, which is what the Upstash version's `PEXPIRE ... NX` amounted
 * to as well: the point is that the window closes under steady load, and a
 * sliding window that is extended by every request never does.
 */
export async function kvIncrement(key, windowMs) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const windowKey = `${key}@${windowStart}`;

  if (!TABLE) {
    const hit = memory.get(windowKey);
    const next = (hit ? Number(hit.value) : 0) + 1;
    // Two windows past the end, matching the TTL below, so the memory map does
    // not grow without bound in a long-running local process.
    memory.set(windowKey, { value: next, expires: windowStart + windowMs * 2 });
    return next;
  }

  const { Attributes } = await docs().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { pk: windowKey },
      UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl) ADD #value :one',
      ExpressionAttributeNames: { '#ttl': 'ttl', '#value': 'value' },
      ExpressionAttributeValues: {
        // A window past the end: the item is never read after its window
        // closes, so the only job left is to be collected eventually.
        ':ttl': toTtlSeconds(windowStart + windowMs * 2),
        ':one': 1,
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  return Number(Attributes?.value ?? 0);
}
