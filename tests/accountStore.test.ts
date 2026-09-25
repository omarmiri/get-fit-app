import { describe, expect, it } from 'vitest';

import { AccountError, MAX_STATE_BYTES, loadState, saveState } from '../account.js';
import { kvGet, kvSet } from '../kv.js';

/*
 * The account's stored history, against the in-memory store.
 *
 * What matters here is the size the store sees. DynamoDB refuses items over
 * 400KB, and plain JSON crossed that in about a year of training — so the
 * history is stored compressed, and these pin that a year fits comfortably.
 */

let n = 0;
const uid = (): string => `user-${++n}`;

/** A year of four sessions a week, eighteen sets each: about 530KB of JSON. */
function aYearOfTraining(): { schemaVersion: number; sessions: unknown[] } {
  const ids = ['legpress', 'chestpress', 'seatedrow', 'rdl', 'shoulderpress', 'latpulldown', 'backsquat'];
  const sessions = Array.from({ length: 208 }, (_, i) => ({
    id: `s${i.toString(36)}abcde`,
    date: `2026-0${1 + (i % 9)}-1${i % 9}`,
    dayKey: 'tue',
    sets: Array.from({ length: 18 }, (_, k) => ({
      exerciseId: ids[(i + k) % ids.length],
      weight: 60 + ((i * 7 + k * 13) % 120),
      reps: 8 + (k % 4),
      unit: 'lb',
      loggedAt: 1_760_000_000_000 + i * 302_400_000 + k * 120_000,
      effort: ['easy', 'right', 'hard'][k % 3],
    })),
    minutes: null,
    modality: null,
    effort: 'Moderate',
    startedAt: 1_760_000_000_000 + i * 302_400_000,
    finishedAt: 1_760_000_000_000 + i * 302_400_000 + 3_600_000,
  }));
  return { schemaVersion: 14, sessions };
}

describe('the stored history', () => {
  it('round-trips exactly', async () => {
    const id = uid();
    const state = aYearOfTraining();
    await saveState(id, state, null);

    expect((await loadState(id))?.state).toEqual(state);
  });

  it('stores a year of training well under the 400KB item limit', async () => {
    const id = uid();
    const state = aYearOfTraining();
    expect(JSON.stringify(state).length).toBeGreaterThan(400 * 1024);

    await saveState(id, state, null);
    const stored = (await kvGet(`fit:state:${id}`)) as { stateGz: Uint8Array; state?: unknown };

    expect(stored.state).toBeUndefined();
    expect(stored.stateGz.length).toBeLessThan(100 * 1024);
  });

  it('still reads a record stored before compression', async () => {
    const id = uid();
    await kvSet(`fit:state:${id}`, { state: { schemaVersion: 13, sessions: [] }, updatedAt: 5 });

    expect(await loadState(id)).toEqual({ state: { schemaVersion: 13, sessions: [] }, updatedAt: 5 });
  });

  it('keeps refusing a write made against a stale version', async () => {
    const id = uid();
    const first = await saveState(id, { sessions: [] }, null);
    await saveState(id, { sessions: [] }, first);

    await expect(saveState(id, { sessions: [] }, first)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a history past the cap with a clear error', async () => {
    const huge = { sessions: [], padding: 'x'.repeat(MAX_STATE_BYTES + 1) };

    await expect(saveState(uid(), huge, null)).rejects.toBeInstanceOf(AccountError);
  });
});
