/**
 * Durable record store.
 *
 * Ported from `local-atlas/store.js`, with one deliberate difference: writes
 * here may have no expiry.
 *
 * That app stored preferences and call records, all of which had a sensible
 * lifetime. This one stores a person's training history, which does not. A TTL
 * on that is a promise to delete someone's logbook on a date nobody chose, and
 * "it expired" is not a thing a training log gets to say.
 *
 * Falls back to memory so the flow works without Upstash configured — the same
 * reasoning as the original, and the same caveat: a restart loses it, which is
 * fine for a demo and not fine for a deploy.
 */

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

/** Local fallback. `expires` of `null` means no expiry. */
const memory = new Map();

export const configured = () => Boolean(REST_URL);

export async function kvGet(key) {
  if (!REST_URL) {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expires !== null && hit.expires <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  }

  const response = await fetch(`${REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!response.ok) throw new Error(`store GET HTTP ${response.status}`);

  const body = await response.json();
  if (typeof body.result !== 'string') return null;
  try {
    return JSON.parse(body.result);
  } catch {
    return null;
  }
}

/**
 * Write a record. Omit `ttlMs` — or pass `null` — for no expiry.
 */
export async function kvSet(key, value, ttlMs = null) {
  if (!REST_URL) {
    memory.set(key, { value, expires: ttlMs === null ? null : Date.now() + ttlMs });
    return;
  }

  const query = ttlMs === null ? '' : `?px=${Math.max(1000, Math.round(ttlMs))}`;
  const response = await fetch(`${REST_URL}/set/${encodeURIComponent(key)}${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`store SET HTTP ${response.status}`);
}

/**
 * Increment a counter that expires, for per-account metering.
 *
 * Returns the new value. Uses Upstash's pipeline so the increment and its
 * expiry are one round-trip — two calls would let a crash between them leave a
 * counter that never resets, which is a quota nobody can spend their way out
 * of.
 */
export async function kvIncrement(key, windowMs) {
  if (!REST_URL) {
    const hit = memory.get(key);
    const live = hit && (hit.expires === null || hit.expires > Date.now());
    const next = (live ? Number(hit.value) : 0) + 1;
    memory.set(key, {
      value: next,
      expires: live ? hit.expires : Date.now() + windowMs,
    });
    return next;
  }

  const response = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify([
      ['INCR', key],
      // NX so an existing window is not extended by later requests inside it,
      // which would make the window slide and never close under steady load.
      ['PEXPIRE', key, String(Math.max(1000, Math.round(windowMs))), 'NX'],
    ]),
  });
  if (!response.ok) throw new Error(`store INCR HTTP ${response.status}`);

  const body = await response.json();
  const first = Array.isArray(body) ? body[0]?.result : null;
  return typeof first === 'number' ? first : 0;
}
