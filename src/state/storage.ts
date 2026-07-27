import type { AppState } from '@/types';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  defaultState,
  parseStateJson,
  serializeState,
} from './schema';

/**
 * Persistence.
 *
 * Backed by `localStorage`, which is synchronous, capped at a few megabytes and
 * — in some privacy modes — throws on mere property access. Every call here is
 * defensive: storage being unavailable degrades the app to in-memory-only for
 * the session rather than breaking it.
 *
 * The `KeyValueStore` seam exists so tests can run without a DOM and so a
 * future IndexedDB or server-backed adapter can drop in without touching
 * calling code.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory fallback used when the browser denies storage access. */
export function createMemoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * The browser's `localStorage`, or an in-memory stand-in when it is unusable.
 *
 * Availability is probed with a real write, because Safari's private mode
 * exposes the API and then throws on `setItem`.
 */
export function resolveBrowserStore(): { store: KeyValueStore; persistent: boolean } {
  try {
    const probe = '__rackfile_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { store: window.localStorage, persistent: true };
  } catch {
    return { store: createMemoryStore(), persistent: false };
  }
}

export interface LoadResult {
  readonly state: AppState;
  /** True when data was read from the v0.1 key and upgraded. */
  readonly migratedFromLegacy: boolean;
  /** Records dropped during validation. */
  readonly dropped: number;
}

/**
 * Read persisted state, upgrading v0.1 data if that is all that exists.
 *
 * The legacy key is deliberately left in place after migration so a user who
 * rolls back to the old build still has their history.
 */
export function loadState(store: KeyValueStore): LoadResult {
  const current = safeGet(store, STORAGE_KEY);
  if (current !== null) {
    const parsed = parseStateJson(current);
    if (parsed.recognised) {
      return { state: parsed.state, migratedFromLegacy: false, dropped: parsed.dropped };
    }
  }

  const legacy = safeGet(store, LEGACY_STORAGE_KEY);
  if (legacy !== null) {
    const parsed = parseStateJson(legacy);
    if (parsed.recognised) {
      return { state: parsed.state, migratedFromLegacy: true, dropped: parsed.dropped };
    }
  }

  return { state: defaultState(), migratedFromLegacy: false, dropped: 0 };
}

/** Why a save failed, for the caller to surface. */
export type SaveFailure = 'quota' | 'unavailable';

/** Write state. Returns `null` on success, or the reason it could not be saved. */
export function saveState(store: KeyValueStore, state: AppState): SaveFailure | null {
  try {
    store.setItem(STORAGE_KEY, serializeState({ ...state, schemaVersion: CURRENT_SCHEMA_VERSION }));
    return null;
  } catch (error) {
    return isQuotaError(error) ? 'quota' : 'unavailable';
  }
}

function safeGet(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Firefox and Chrome disagree on the name; both are checked.
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * Wrap a save function so bursts of state changes produce one write.
 *
 * Logging a set re-renders and saves; without this, a fast set of taps would
 * serialize the entire history several times per second.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
): ((...args: T) => void) & { flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;

  const run = (): void => {
    timer = undefined;
    if (pending) {
      const args = pending;
      pending = undefined;
      fn(...args);
    }
  };

  const wrapped = (...args: T): void => {
    pending = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  };

  wrapped.flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    run();
  };

  return wrapped;
}
