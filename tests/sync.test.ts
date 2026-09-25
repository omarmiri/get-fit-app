import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppState, UserPlan } from '@/types';
import { defaultState } from '@/state/schema';
import { AppStore } from '@/state/store';
import { createMemoryStore } from '@/state/storage';

/*
 * Two devices against one fake account server.
 *
 * Each device is its own copy of `sync.ts` — it keeps module state, as it does
 * in a real tab — and its own localStorage, swapped in before it acts. The
 * server enforces the same rule the real one does: a push against a stale
 * `updatedAt` is refused with 409.
 */

class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const server: {
  state: AppState | null;
  updatedAt: number | null;
  clock: number;
  interfere: (() => void) | null;
} = { state: null, updatedAt: null, clock: 1000, interfere: null };

function write(state: AppState): number {
  server.state = JSON.parse(JSON.stringify(state)) as AppState;
  server.updatedAt = ++server.clock;
  return server.updatedAt;
}

vi.mock('@/services/account', () => ({
  AccountError,
  currentUser: () => ({ id: 'u1', email: 'me@example.com' }),
  pullState: () =>
    Promise.resolve({
      state: server.state ? (JSON.parse(JSON.stringify(server.state)) as AppState) : null,
      updatedAt: server.updatedAt,
    }),
  pushState: (state: AppState, base: number | null) => {
    const interfere = server.interfere;
    server.interfere = null;
    interfere?.();
    if (base !== server.updatedAt) return Promise.reject(new AccountError('conflict', 409));
    return Promise.resolve(write(state));
  },
}));

interface Device {
  readonly store: AppStore;
  sync(): Promise<void>;
}

async function device(initial: AppState = defaultState()): Promise<Device> {
  const storage = new Map<string, string>();
  const local = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };
  const use = (): void => void vi.stubGlobal('localStorage', local);

  use();
  vi.resetModules();
  const sync = await import('@/services/sync');
  const store = new AppStore({ initialState: initial, store: createMemoryStore(), saveDelayMs: 0 });
  sync.initSync(store);

  return {
    store,
    async sync() {
      use();
      await sync.syncNow({ report: true });
    },
  };
}

/** A plan the schema parser accepts — the server copy goes through it. */
function plan(id: string): UserPlan {
  return {
    id,
    summary: `Summary for ${id}`,
    days: [
      {
        dayKey: 'tue',
        label: 'Strength',
        type: 'strength',
        sub: '',
        note: '',
        outline: ['Lift'],
        aerobic: false,
        exerciseIds: ['legpress'],
      },
    ],
    generatedAt: 1_700_000_000_000,
    model: 'test-model',
  };
}

beforeEach(() => {
  Object.assign(server, { state: null, updatedAt: null, clock: 1000, interfere: null });
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync between two devices', () => {
  it('carries a plan written on the PC to a fresh phone', async () => {
    const pc = await device();
    pc.store.adoptPlan(plan('p1'));
    await pc.sync();

    const phone = await device();
    await phone.sync();

    expect(phone.store.getState().plans.map((p) => p.id)).toEqual(['p1']);
    expect(phone.store.getState().activePlanId).toBe('p1');
  });

  it('does not let a fresh phone wipe the account on sign-in', async () => {
    const pc = await device();
    pc.store.adoptPlan(plan('p1'));
    await pc.sync();

    const phone = await device();
    await phone.sync();
    await pc.sync();

    expect(pc.store.getState().plans.map((p) => p.id)).toEqual(['p1']);
  });

  it('brings a session logged on the phone back to the PC, and deletions both ways', async () => {
    const pc = await device();
    pc.store.adoptPlan(plan('p1'));
    pc.store.adoptPlan(plan('p2'));
    await pc.sync();

    const phone = await device();
    await phone.sync();
    phone.store.finishActive('mon', 30);
    phone.store.deletePlan('p1');
    await phone.sync();

    await pc.sync();
    expect(pc.store.getState().sessions).toHaveLength(1);
    expect(pc.store.getState().plans.map((p) => p.id)).toEqual(['p2']);
  });

  it('merges instead of overwriting when both changed offline', async () => {
    const pc = await device();
    await pc.sync();
    const phone = await device();
    await phone.sync();

    pc.store.adoptPlan(plan('p1'));
    phone.store.finishActive('mon', 30);

    await phone.sync();
    await pc.sync();
    await phone.sync();

    for (const each of [pc, phone]) {
      expect(each.store.getState().plans.map((p) => p.id)).toEqual(['p1']);
      expect(each.store.getState().sessions).toHaveLength(1);
    }
  });

  it('pulls and merges again when another device writes mid-sync', async () => {
    const pc = await device();
    pc.store.adoptPlan(plan('p1'));
    await pc.sync();

    // Another device's write lands between this sync's pull and its push.
    server.interfere = () => {
      const other = server.state;
      if (!other) throw new Error('expected a stored state');
      write({ ...other, plans: [...other.plans, plan('p9')] });
    };
    pc.store.adoptPlan(plan('p2'));
    await pc.sync();

    expect(server.state?.plans.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p9']);
    expect(
      pc.store
        .getState()
        .plans.map((p) => p.id)
        .sort(),
    ).toEqual(['p1', 'p2', 'p9']);
  });

  it('leaves a workout in progress alone', async () => {
    const pc = await device();
    await pc.sync();
    const phone = await device();
    await phone.sync();

    phone.store.startSession('mon');
    pc.store.adoptPlan(plan('p1'));
    await pc.sync();
    await phone.sync();

    // Not applied mid-workout…
    expect(phone.store.getState().activePlanId).toBeNull();

    phone.store.finishActive('mon', 30);
    await phone.sync();

    // …and picked up once it is over, without losing the session.
    expect(phone.store.getState().activePlanId).toBe('p1');
    expect(server.state?.sessions).toHaveLength(1);
  });
});
