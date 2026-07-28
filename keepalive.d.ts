/**
 * Types for `keepalive.js`.
 *
 * The module itself is plain JavaScript because it runs in the Node server
 * process, which is not part of the Vite/TypeScript build. This declaration
 * exists so the tests — and any future consumer — get real types instead of
 * `any`, rather than the whole file being waved through with a suppression.
 */

/** The hour of the day in New York, 0-23, daylight saving accounted for. */
export function newYorkHour(now?: Date): number;

/** Whether the service should be held awake at this moment. */
export function isWithinWakeWindow(now?: Date): boolean;

export interface KeepAliveOptions {
  log?: (message: string) => void;
}

/**
 * Start pinging this service's own public URL during waking hours.
 *
 * Returns a stop function, or `null` when keep-alive is inactive — no
 * `RENDER_EXTERNAL_URL`, or `KEEP_ALIVE=false`.
 */
export function startKeepAlive(options?: KeepAliveOptions): (() => void) | null;
