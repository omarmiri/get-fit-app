import { describe, expect, it } from 'vitest';

import type { AppState, Session, UserPlan } from '@/types';
import { defaultState } from '@/state/schema';
import { fingerprint, hash, mergeStates, sameContent } from '@/state/merge';

function plan(id: string, overrides: Partial<UserPlan> = {}): UserPlan {
  return { id, summary: `plan ${id}`, days: [], generatedAt: 1, model: 'test', ...overrides };
}

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    date: '2026-09-01',
    dayKey: 'mon',
    sets: [],
    minutes: 30,
    modality: null,
    effort: null,
    startedAt: 100,
    finishedAt: 200,
    ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...defaultState(), ...overrides };
}

describe('mergeStates — first sync on a device (no base)', () => {
  it('brings a plan written on another device onto a fresh one', () => {
    const pc = state({
      plans: [plan('p1')],
      activePlanId: 'p1',
      prefs: { ...defaultState().prefs, welcomed: true },
    });
    const phone = state();

    const merged = mergeStates(phone, pc, null);

    expect(merged.plans.map((p) => p.id)).toEqual(['p1']);
    expect(merged.activePlanId).toBe('p1');
    expect(merged.prefs.welcomed).toBe(true);
  });

  it('keeps history logged here before signing in, alongside the account’s', () => {
    const here = state({ sessions: [session('a')] });
    const account = state({ sessions: [session('b', { date: '2026-09-02' })] });

    expect(mergeStates(here, account, null).sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('does not clear a setting the account simply never had', () => {
    const here = state({ prefs: { ...defaultState().prefs, gym: 'Basement rack' } });
    const account = state();

    expect(mergeStates(here, account, null).prefs.gym).toBe('Basement rack');
  });
});

describe('mergeStates — with a base', () => {
  it('propagates a deletion made on this device', () => {
    const synced = state({ plans: [plan('p1'), plan('p2')] });
    const here = state({ plans: [plan('p1')] });

    const merged = mergeStates(here, synced, fingerprint(synced));

    expect(merged.plans.map((p) => p.id)).toEqual(['p1']);
  });

  it('applies a deletion made on the other device', () => {
    const synced = state({ sessions: [session('a'), session('b', { date: '2026-09-02' })] });
    const there = state({ sessions: [session('a')] });

    expect(mergeStates(synced, there, fingerprint(synced)).sessions.map((s) => s.id)).toEqual(['a']);
  });

  it('keeps an edit over a deletion of the same record', () => {
    const synced = state({ plans: [plan('p1')] });
    const here = state({ plans: [plan('p1', { name: 'Winter block' })] });
    const there = state({ plans: [] });

    expect(mergeStates(here, there, fingerprint(synced)).plans[0]?.name).toBe('Winter block');
  });

  it('takes the other device’s edit when this one did not touch the record', () => {
    const synced = state({ plans: [plan('p1')], activePlanId: 'p1' });
    const there = state({ plans: [plan('p1', { name: 'Renamed on PC' }), plan('p2')], activePlanId: 'p2' });

    const merged = mergeStates(synced, there, fingerprint(synced));

    expect(merged.plans.map((p) => p.name ?? p.id)).toEqual(['Renamed on PC', 'p2']);
    expect(merged.activePlanId).toBe('p2');
  });

  it('settles a plan renamed on both sides in favour of this device', () => {
    const synced = state({ plans: [plan('p1')] });
    const here = state({ plans: [plan('p1', { name: 'Mine' })] });
    const there = state({ plans: [plan('p1', { name: 'Theirs' })] });

    expect(mergeStates(here, there, fingerprint(synced)).plans[0]?.name).toBe('Mine');
  });

  it('settles a session changed on both sides in favour of the later finish', () => {
    const synced = state({ sessions: [session('a')] });
    const here = state({ sessions: [session('a', { minutes: 40, finishedAt: 300 })] });
    const there = state({ sessions: [session('a', { minutes: 50, finishedAt: 400 })] });

    expect(mergeStates(here, there, fingerprint(synced)).sessions[0]?.minutes).toBe(50);
  });

  it('falls back to the built-in week when the plan in force was deleted elsewhere', () => {
    const synced = state({ plans: [plan('p1')], activePlanId: 'p1' });
    const there = state({ plans: [], activePlanId: null });

    expect(mergeStates(synced, there, fingerprint(synced)).activePlanId).toBeNull();
  });
});

describe('mergeStates — the workout in progress', () => {
  it('is never replaced by another device’s', () => {
    const { finishedAt: _open, ...mine } = session('live');
    const here = state({ active: mine });
    const there = state({ active: session('other') });

    expect(mergeStates(here, there, null).active).toBe(mine);
  });
});

describe('hash and sameContent', () => {
  it('ignores key order', () => {
    expect(hash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });

  it('tells different values apart', () => {
    expect(hash({ a: 1 })).not.toBe(hash({ a: 2 }));
    expect(hash(null)).not.toBe(hash(undefined));
  });

  it('ignores the workout in progress', () => {
    expect(sameContent(state({ active: session('x') }), state())).toBe(true);
    expect(sameContent(state({ sessions: [session('x')] }), state())).toBe(false);
  });
});
