/**
 * Types for `kv.js`, for the tests. See `sessions.d.ts` for the arrangement.
 */

export const configured: () => boolean;

export class KvConflict extends Error {}

export function kvGet(key: string): Promise<unknown>;
export function kvSet(key: string, value: unknown, ttlMs?: number | null): Promise<void>;
export function kvSetIf(key: string, value: unknown, field: string, expected: unknown): Promise<void>;
export function kvDelete(key: string): Promise<void>;
export function kvIncrement(key: string, windowMs: number): Promise<number>;
