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

let writes = 0;

function write(state: AppState): number {
  writes += 1;
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
  /** "Sync now": the explicit kind, which also runs mid-workout. */
  sync(): Promise<void>;
  /** The automatic kind — opening the app, or coming back to it. */
  autoSync(): Promise<void>;
  /** The app being closed. */
  close(): Promise<void>;
  /** "Reset account and start over". */
  reset(): Promise<void>;
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
  // Let the sync that starts with the app settle, as it does long before anyone taps anything.
  await sync.syncNow();

  return {
    store,
    async sync() {
      use();
      await sync.syncNow({ report: true });
    },
    async autoSync() {
      use();
      await sync.syncNow();
    },
    async reset() {
      use();
      await sync.resetEverything();
    },
    async close() {
      use();
      sync.flushSync();
      // flushSync is fire-and-forget; let its push settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
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

describe('during a workout', () => {
  it('uploads nothing per set, one push if the app closes, and syncs when finished', async () => {
    const phone = await device();
    await phone.sync();

    phone.store.startSession('mon');
    const before = writes;
    for (let set = 0; set < 5; set++) phone.store.logSet('mon', 'legpress', 100, 10, 'lb');
    await phone.autoSync();
    await phone.autoSync();
    expect(writes).toBe(before);

    await phone.close();
    expect(writes).toBe(before + 1);

    phone.store.finishActive('mon', 30);
    await phone.autoSync();
    expect(server.state?.sessions).toHaveLength(1);
  });
});

describe('Sync now, mid-workout', () => {
  it('brings plans in on a device that never synced, without switching the plan being trained', async () => {
    const web = await device();
    web.store.adoptPlan(plan('w1'));
    web.store.adoptPlan(plan('w2'));
    await web.sync();

    // The phone: its own plan, a workout under way, never synced before.
    const phone = await device();
    phone.store.adoptPlan(plan('p1'));
    phone.store.startSession('mon');
    await phone.sync();

    const state = phone.store.getState();
    expect(state.plans.map((p) => p.id).sort()).toEqual(['p1', 'w1', 'w2']);
    expect(state.activePlanId).toBe('p1');
    expect(state.active).not.toBeNull();
    expect(server.state?.plans.map((p) => p.id).sort()).toEqual(['p1', 'w1', 'w2']);
  });
});

describe('a session left open', () => {
  it('stops holding sync back once it is older than any real workout', async () => {
    const web = await device();
    web.store.adoptPlan(plan('w1'));
    await web.sync();

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const phone = await device();
      phone.store.startSession('mon');
      vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);

      await phone.autoSync();
      expect(phone.store.getState().plans.map((p) => p.id)).toEqual(['w1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('starting over', () => {
  it('empties the account, and other devices follow — except what they added since', async () => {
    const pc = await device();
    pc.store.adoptPlan(plan('p1'));
    pc.store.finishActive('mon', 30);
    await pc.sync();

    const phone = await device();
    await phone.sync();
    expect(phone.store.getState().plans).toHaveLength(1);

    // Added on the PC after its last sync, so it is not part of what was reset.
    pc.store.adoptPlan(plan('p2'));

    await phone.reset();
    expect(phone.store.getState().plans).toEqual([]);
    expect(phone.store.getState().sessions).toEqual([]);
    expect(phone.store.getState().prefs.welcomed).not.toBe(true);
    expect(server.state?.plans).toEqual([]);
    expect(server.state?.sessions).toEqual([]);

    await pc.sync();
    expect(pc.store.getState().plans.map((p) => p.id)).toEqual(['p2']);
    expect(pc.store.getState().sessions).toEqual([]);
  });
});
