/**
 * Types for `sessions.js`.
 *
 * Hand-written alongside the plain JS module, the same arrangement as
 * `keepalive.d.ts` and `auth.d.ts`: the server runs unbundled JavaScript, and
 * this is how the TypeScript side of the codebase — the tests — sees it.
 */
import type { UserPlan } from '@/types';

/** How long a session accepts pushes. */
export const SESSION_TTL_MS: number;

/** Plans one session will accept over its lifetime. */
export const MAX_PUSHES: number;

/** Cap on a single pushed plan, in bytes of JSON. */
export const MAX_PLAN_BYTES: number;

/**
 * A refusal with an HTTP status and a stable code.
 *
 * The `code` is what a pushing client branches on; the `message` is what it
 * shows, or acts on, when the refusal is something it can fix.
 */
export class DropError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string);
}

/** One plan pushed to a session. */
export interface DroppedPlan {
  /** 1-based, in arrival order — what the app calls "v2". */
  readonly version: number;
  readonly receivedAt: number;
  readonly plan: UserPlan;
}

/**
 * A newly opened session.
 *
 * `pushId` is safe to put in front of a language model. `pollToken` is not —
 * see the note on the two ids in `sessions.js`.
 */
export interface NewSession {
  readonly pushId: string;
  readonly pollToken: string;
  readonly expiresAt: number;
}

export function createSession(): Promise<NewSession>;

/** What a successful push reports back to the pushing client. */
export interface PushResult {
  readonly version: number;
  readonly accepted: number;
  readonly remaining: number;
  /** What the parser mended in the week, when anything. */
  readonly corrections?: readonly string[];
}

export function pushPlan(pushId: string, body: unknown): Promise<PushResult>;

export function readSession(
  pushId: string,
  pollToken: string,
): Promise<{ expiresAt: number; plans: readonly DroppedPlan[] }>;
