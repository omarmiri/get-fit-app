/**
 * Types for `account.js`.
 *
 * Hand-written alongside the plain JS module, the same arrangement as
 * `sessions.d.ts` and `auth.d.ts`: the server runs unbundled JavaScript, and
 * this is how the TypeScript side of the codebase — the tests — sees it.
 */

/** Cap on a history as the client sends it, in bytes of JSON. */
export const MAX_STATE_BYTES: number;

export class AccountError extends Error {
  constructor(message: string, status: number);
  readonly status: number;
}

/** The stored history, or `null` when the account has none yet. */
export function loadState(uid: string): Promise<{ state: unknown; updatedAt: number | null } | null>;

/**
 * Store a history. Returns the new `updatedAt`.
 *
 * `baseUpdatedAt` is the version it was merged against (`null` for none
 * stored); a stale one rejects with status 409. `undefined` writes
 * unconditionally.
 */
export function saveState(uid: string, state: unknown, baseUpdatedAt?: number | null): Promise<number>;
