/**
 * Types for `auth.js`.
 *
 * The module itself is plain JavaScript because it runs in the Node server
 * process, which is not part of the Vite/TypeScript build. This declaration
 * exists so the tests — and any future consumer — get real types instead of
 * `any`, rather than the whole file being waved through with a suppression.
 */

import type { NextFunction, Request, Response } from 'express';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
}

/** Thrown for conditions the caller should see verbatim. */
export class AuthError extends Error {
  constructor(message: string, status: number);
  readonly status: number;
}

/**
 * Reduce a pasted `SUPABASE_URL` to the project origin.
 *
 * Strips a trailing slash and any of Supabase's own API path suffixes, which
 * the dashboard shows in several places and which would otherwise be
 * concatenated with this app's own `/auth/v1/...` paths.
 */
export function normalizeProjectUrl(raw: unknown): string;

/** Whether a Supabase project URL and anon key are both present. */
export function configured(): boolean;

/** Resolve a bearer token to a user, or `null`. Never throws. */
export function verifyToken(token: string): Promise<AuthUser | null>;

/** Attach `req.user` when a valid token is present; say nothing otherwise. */
export function attachUser(req: Request, res: Response, next: NextFunction): Promise<void>;

/** Gate a route on a signed-in user. */
export function requireUser(req: Request, res: Response, next: NextFunction): void;

/** Where the browser must navigate to start Google sign-in. */
export function authorizeUrl(redirectTo: string): string;

/** Trade a refresh token for a fresh session. */
export function refreshSession(refreshToken: string): Promise<Record<string, unknown>>;

/** Public configuration for the client: whether accounts exist, and where. */
export function info(): { configured: boolean; url: string };
