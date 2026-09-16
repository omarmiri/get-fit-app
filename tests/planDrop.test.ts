import { afterEach, describe, expect, it, vi } from 'vitest';

// Plain JS server module, typed by sessions.d.ts.
import { DropError, MAX_PUSHES, createSession, pushPlan, readSession } from '../sessions.js';

/**
 * Plan drops.
 *
 * Two of the tests below are the reason this file exists, and neither is about
 * whether the happy path works.
 *
 * The first is that a push id cannot read. That id is written into a prompt
 * and pasted into somebody else's chat product, so it should be assumed public
 * forever; the whole design rests on it granting nothing but writing. If that
 * ever silently becomes readable, a training plan — a fairly good guess at
 * what someone's body is doing — leaks to anyone who has scrolled a chat log.
 *
 * The second is that a pushed plan cannot carry health context back. The app
 * promises the survey never leaves the device, and the push endpoint is the
 * one route where a third party could return it. That promise is kept by
 * construction rather than by filtering — `parsePortablePlan` builds a plan
 * out of fields it knows — but "by construction" is a claim, and a claim about
 * someone's medical history is worth pinning to a test.
 */

/** The minimum a plan needs to survive the parser. */
const validPlan = {
  kind: 'rackfile.plan',
  formatVersion: 1,
  summary: 'A test week',
  days: [{ dayKey: 'mon', label: 'Push', type: 'strength', exerciseIds: ['bench-press'] }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createSession', () => {
  it('issues a push id a person can retype', async () => {
    const { pushId } = await createSession();

    // Two groups of five, from an alphabet with no look-alike characters. The
    // id passes through a model's output and sometimes a person's fingers.
    expect(pushId).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(pushId).not.toMatch(/[ILOU]/);
  });

  it('issues a poll token that is not derivable from the push id', async () => {
    const { pushId, pollToken } = await createSession();

    expect(pollToken).toHaveLength(32);
    expect(pollToken).not.toContain(pushId.replace('-', ''));
  });

  it('gives every session a different push id', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => createSession()));

    expect(new Set(ids.map((s) => s.pushId)).size).toBe(20);
  });
});

describe('pushPlan', () => {
  it('accepts a plan and numbers it', async () => {
    const { pushId } = await createSession();

    expect((await pushPlan(pushId, { plan: validPlan })).version).toBe(1);
    expect((await pushPlan(pushId, { plan: validPlan })).version).toBe(2);
  });

  it('takes a bare plan as well as a wrapped one', async () => {
    // A model told to POST "the plan" may reasonably send either shape, and
    // being strict here would fail a plan that is in every other way correct.
    const { pushId, pollToken } = await createSession();
    await pushPlan(pushId, validPlan);

    expect((await readSession(pushId, pollToken)).plans).toHaveLength(1);
  });

  it('refuses an unknown session without confirming anything about it', async () => {
    await expect(pushPlan('ZZZZZ-ZZZZZ', { plan: validPlan })).rejects.toMatchObject({
      status: 404,
      code: 'unknown_session',
    });
  });

  it('tells a model why its plan was rejected', async () => {
    const { pushId } = await createSession();

    // The point of the push over a paste: the model can read this and correct
    // itself on the next turn, instead of the user carrying the error back.
    await expect(pushPlan(pushId, { plan: { formatVersion: 1 } })).rejects.toThrow(/days/);
  });

  it('rate limits a burst within one minute', async () => {
    // In front of the lifetime cap, and much tighter: a person iterating on a
    // plan with an LLM does not push six times in a minute, but a loop does.
    const { pushId } = await createSession();

    const results = [];
    for (let i = 0; i < 8; i += 1) {
      // Sequential on purpose: the limit is about arrival order.
      results.push(await pushPlan(pushId, { plan: validPlan }).catch((error: DropError) => error.code));
    }

    expect(results).toContain('rate_limited');
  });

  it('stops accepting after the lifetime cap', async () => {
    // Stepping the clock a minute between pushes so the per-minute limit above
    // is not what ends this — the cap being tested is the lifetime one.
    vi.useFakeTimers();
    const { pushId } = await createSession();

    for (let i = 0; i < MAX_PUSHES; i += 1) {
      vi.advanceTimersByTime(61_000);
      // Sequential by design: versions are assigned in arrival order.
      await pushPlan(pushId, { plan: validPlan });
    }

    vi.advanceTimersByTime(61_000);
    await expect(pushPlan(pushId, { plan: validPlan })).rejects.toMatchObject({
      code: 'session_full',
    });
  });

  it('refuses a plan larger than the cap', async () => {
    const { pushId } = await createSession();
    const huge = { ...validPlan, summary: 'x'.repeat(200_000) };

    await expect(pushPlan(pushId, { plan: huge })).rejects.toMatchObject({ status: 413 });
  });
});

describe('readSession', () => {
  it('returns what was pushed, to the device that opened the session', async () => {
    const { pushId, pollToken } = await createSession();
    await pushPlan(pushId, { plan: validPlan });

    const { plans } = await readSession(pushId, pollToken);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.plan.days[0]?.dayKey).toBe('mon');
  });

  /**
   * The security property the whole two-id design exists for.
   */
  it('does not let the push id alone read the session', async () => {
    const { pushId } = await createSession();
    await pushPlan(pushId, { plan: validPlan });

    await expect(readSession(pushId, '')).rejects.toBeInstanceOf(DropError);
  });

  it('does not let a wrong poll token read the session', async () => {
    const { pushId } = await createSession();
    await pushPlan(pushId, { plan: validPlan });

    await expect(readSession(pushId, 'x'.repeat(32))).rejects.toMatchObject({
      // A 404 rather than a 403: there is no reason to confirm to a caller
      // holding a guessed id that it named something real.
      status: 404,
    });
  });
});

describe('what a pushed plan cannot carry', () => {
  /**
   * The privacy promise, pinned.
   *
   * The survey is typed on the device and never sent anywhere. This is the one
   * route by which a third party could hand it back, and it must not be able
   * to — whatever the model decides to append to its output.
   */
  it('drops fields the plan format does not define', async () => {
    const { pushId, pollToken } = await createSession();

    await pushPlan(pushId, {
      plan: {
        ...validPlan,
        rationale: 'Programmed around a herniated L4-L5 disc',
        patientNotes: 'type 2 diabetes, on metformin',
        intake: { age: 41, conditions: ['hypertension'] },
      },
    });

    const stored = JSON.stringify((await readSession(pushId, pollToken)).plans);

    expect(stored).not.toContain('herniated');
    expect(stored).not.toContain('metformin');
    expect(stored).not.toContain('hypertension');
    expect(stored).not.toContain('intake');
  });

  it('keeps the training content while dropping the rest', async () => {
    // The previous test would also pass if the parser threw everything away.
    const { pushId, pollToken } = await createSession();

    await pushPlan(pushId, { plan: { ...validPlan, patientNotes: 'confidential' } });
    const { plans } = await readSession(pushId, pollToken);

    expect(plans[0]?.plan.summary).toBe('A test week');
    expect(plans[0]?.plan.days).toHaveLength(1);
  });
});
