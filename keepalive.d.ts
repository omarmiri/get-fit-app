/**
 * Types for `keepalive.js`.
 *
 * The module itself is plain JavaScript because it runs in the Node server
 * process, which is not part of the Vite/TypeScript build. This declaration
 * exists so the tests — and any future consumer — get real types instead of
 * `any`, rather than the whole file being waved through with a suppression.
 */

export interface HeartbeatResult {
  /** Epoch ms of the attempt. */
  readonly at: number;
  readonly ok: boolean;
  /** HTTP status, or 0 when the request never completed. */
  readonly status: number;
}

/** The last Supabase beat this process attempted, or `null` if none yet. */
export function lastHeartbeat(): HeartbeatResult | null;

export interface SupabaseHeartbeatOptions {
  url?: string;
  anonKey?: string;
  log?: (message: string) => void;
}

/**
 * Start beating against the Supabase project so it is not paused for
 * inactivity. Returns a stop function, or `null` when inactive.
 */
export function startSupabaseHeartbeat(options?: SupabaseHeartbeatOptions): (() => void) | null;
