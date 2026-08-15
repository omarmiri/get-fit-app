import { describe, expect, it } from 'vitest';

import {
  CUSTOM_ID_PREFIX,
  PLAN_FORMAT_VERSION,
  PLAN_KIND,
  isCustomExerciseId,
  parseCustomExercise,
  parsePortablePlan,
} from '@/domain/planFormat';
import { getBuiltinExercise } from '@/data/exercises';
import { resolveExercise } from '@/data/catalogue';

/**
 * Guards on the interchange format.
 *
 * This parser is the only thing standing between "any LLM can write a plan"
 * and arbitrary generated JSON reaching the app's persisted state. Its
 * contract is that it never throws, never lets an author claim a built-in
 * exercise id, and never stores an unbounded string. These tests exist to keep
 * those three promises rather than to exercise the happy path.
 */

function minimalPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: PLAN_KIND,
    formatVersion: PLAN_FORMAT_VERSION,
    summary: 'A week.',
    days: [
      {
        dayKey: 'mon',
        label: 'Strength',
        type: 'strength',
        sub: 'Full body',
        note: 'Rest as needed.',
        outline: ['Warm up', 'Lift'],
        aerobic: false,
        exerciseIds: ['legpress'],
      },
    ],
    ...overrides,
  };
}

describe('envelope', () => {
  it('accepts a well-formed plan', () => {
    const { plan, error } = parsePortablePlan(minimalPlan());

    expect(error).toBeNull();
    expect(plan?.days).toHaveLength(1);
    expect(plan?.days[0]?.dayKey).toBe('mon');
  });

  it('rejects a file addressed to something else', () => {
    const { plan, error } = parsePortablePlan(minimalPlan({ kind: 'someones.other.app' }));

    expect(plan).toBeNull();
    expect(error).toContain('someones.other.app');
  });

  it('tolerates a missing kind, since people hand-write these', () => {
    const raw = minimalPlan();
    delete raw['kind'];

    expect(parsePortablePlan(raw).plan).not.toBeNull();
  });

  it('refuses a format from the future rather than guessing at it', () => {
    const { plan, error } = parsePortablePlan(minimalPlan({ formatVersion: PLAN_FORMAT_VERSION + 1 }));

    expect(plan).toBeNull();
    expect(error).toContain('Update the app');
  });

  it('reports a plan with no readable days', () => {
    const { plan, error } = parsePortablePlan(minimalPlan({ days: [{ dayKey: 'noneday' }] }));

    expect(plan).toBeNull();
    expect(error).toContain('None of the days');
  });
});

describe('tolerating what people actually paste', () => {
  it('digs the plan out of a fenced code block', () => {
    const text = `Sure! Here is your week:\n\n\`\`\`json\n${JSON.stringify(minimalPlan())}\n\`\`\`\n\nLet me know if you want changes.`;

    expect(parsePortablePlan(text).plan).not.toBeNull();
  });

  it('prefers the largest fenced block over a short illustrative one', () => {
    const text = `Example shape:\n\`\`\`json\n{"kind":"rackfile.plan"}\n\`\`\`\nAnd the real plan:\n\`\`\`json\n${JSON.stringify(minimalPlan())}\n\`\`\``;

    expect(parsePortablePlan(text).plan?.days).toHaveLength(1);
  });

  it('finds a bare object embedded in prose', () => {
    const text = `Here you go: ${JSON.stringify(minimalPlan())} — enjoy!`;

    expect(parsePortablePlan(text).plan).not.toBeNull();
  });

  it('explains itself when handed something that is not JSON at all', () => {
    const { plan, error } = parsePortablePlan('I would recommend three sets of squats.');

    expect(plan).toBeNull();
    expect(error).toContain('JSON');
  });

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      null,
      undefined,
      42,
      '',
      '{',
      [],
      { days: 'not an array' },
      { days: [null, 3, 'x'] },
      { kind: PLAN_KIND, days: [{ dayKey: 'mon', outline: { not: 'an array' } }] },
    ];

    for (const input of nasty) {
      expect(() => parsePortablePlan(input)).not.toThrow();
    }
  });
});

describe('custom exercise identity', () => {
  it('namespaces every authored id', () => {
    const { plan } = parsePortablePlan(
      minimalPlan({
        exercises: [{ id: 'bulgarian-split-squat', name: 'Bulgarian split squat', loaded: true }],
      }),
    );

    expect(plan?.exercises?.[0]?.id).toBe(`${CUSTOM_ID_PREFIX}bulgarian-split-squat`);
    expect(isCustomExerciseId(plan?.exercises?.[0]?.id ?? '')).toBe(true);
  });

  it('cannot hijack a built-in id, however hard it tries', () => {
    /*
     * The failure this namespace exists to prevent. Logged sets reference
     * exercise ids forever; an imported plan that could define `legpress`
     * would silently rewrite the meaning of every leg press already in the
     * user's history.
     */
    const { plan } = parsePortablePlan(
      minimalPlan({ exercises: [{ id: 'legpress', name: 'Definitely not the leg press', loaded: true }] }),
    );

    const custom = plan?.exercises?.[0];
    expect(custom?.id).toBe(`${CUSTOM_ID_PREFIX}legpress`);
    expect(getBuiltinExercise('legpress')?.name).toBe('Leg press');
    expect(resolveExercise('legpress', { plan })?.name).toBe('Leg press');
  });

  it('does not double-prefix an id that already carries the namespace', () => {
    const parsed = parseCustomExercise({ id: `${CUSTOM_ID_PREFIX}sled-push`, name: 'Sled push' });

    expect(parsed?.id).toBe(`${CUSTOM_ID_PREFIX}sled-push`);
  });

  it('falls back to a slug of the name when no id is given', () => {
    const parsed = parseCustomExercise({ name: 'Single-leg RDL' });

    expect(parsed?.id).toBe(`${CUSTOM_ID_PREFIX}single-leg-rdl`);
  });

  it('drops a movement with no name to reference it by', () => {
    expect(parseCustomExercise({ id: 'mystery' })).toBeNull();
  });
});

describe('custom exercise fields', () => {
  it('derives the display rep range rather than accepting one', () => {
    // `repRange` is display copy the app owns. An author who could set it
    // freely could put coaching instructions where a rep range belongs.
    const parsed = parseCustomExercise({
      name: 'Row',
      repMin: 6,
      repMax: 10,
      repRange: '6-10 AND GO HEAVY!!',
    });

    expect(parsed?.repRange).toBe('6–10');
    expect(parsed?.defaultReps).toBe(8);
  });

  it('collapses a single-value rep range', () => {
    expect(parseCustomExercise({ name: 'Single', repMin: 5, repMax: 5 })?.repRange).toBe('5');
  });

  it('clamps implausible set counts and rest intervals', () => {
    const parsed = parseCustomExercise({ name: 'Excessive', sets: 500, restSeconds: 99999 });

    expect(parsed?.sets).toBe(12);
    expect(parsed?.restSeconds).toBe(600);
  });

  it('defaults a timed hold differently from a rep-counted lift', () => {
    const hold = parseCustomExercise({ name: 'Hold', repMetric: 'seconds' });
    const lift = parseCustomExercise({ name: 'Lift', repMetric: 'reps' });

    expect(hold?.repMin).toBe(20);
    expect(hold?.restSeconds).toBe(45);
    expect(lift?.repMin).toBe(8);
    expect(lift?.restSeconds).toBe(90);
  });

  it('fills missing cues with something honest rather than blank', () => {
    const parsed = parseCustomExercise({ name: 'Undescribed' });

    expect(parsed?.cues.setup).toContain('did not describe');
    expect(parsed?.cues.avoid).toContain('Start light');
  });

  it('caps every string the author controls', () => {
    const parsed = parseCustomExercise({
      name: 'x'.repeat(5000),
      summary: 'y'.repeat(5000),
      equipment: 'z'.repeat(5000),
      cues: { setup: 'a'.repeat(5000), execute: 'b'.repeat(5000), avoid: 'c'.repeat(5000) },
    });

    expect(parsed?.name.length).toBeLessThanOrEqual(80);
    expect(parsed?.summary?.length).toBeLessThanOrEqual(300);
    expect(parsed?.equipment?.length).toBeLessThanOrEqual(200);
    expect(parsed?.cues.setup.length).toBeLessThanOrEqual(400);
  });

  it('caps how many movements one plan may define', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `move-${i}`, name: `Move ${i}` }));
    const { plan } = parsePortablePlan(minimalPlan({ exercises: many }));

    expect(plan?.exercises?.length).toBeLessThanOrEqual(60);
  });
});

describe('opening weight', () => {
  it('keeps a plausible opening weight on a loaded movement', () => {
    const parsed = parseCustomExercise({
      name: 'Sled push',
      loaded: true,
      openingWeight: { value: 90, unit: 'lb' },
    });

    expect(parsed?.openingWeight).toEqual({ value: 90, unit: 'lb' });
  });

  it('drops an opening weight on an unloaded movement', () => {
    // A suggested load for a plank is a category error. Dropping it beats
    // rendering a weight stepper on a bodyweight hold.
    const parsed = parseCustomExercise({
      name: 'Plank',
      loaded: false,
      openingWeight: { value: 45, unit: 'lb' },
    });

    expect(parsed?.openingWeight).toBeUndefined();
  });

  it('ignores a malformed or absurd opening weight', () => {
    const noUnit = parseCustomExercise({ name: 'A', loaded: true, openingWeight: { value: 50 } });
    const absurd = parseCustomExercise({
      name: 'B',
      loaded: true,
      openingWeight: { value: 99999, unit: 'lb' },
    });
    const garbage = parseCustomExercise({ name: 'C', loaded: true, openingWeight: 'heavy' });

    expect(noUnit?.openingWeight).toEqual({ value: 50, unit: 'lb' });
    expect(absurd?.openingWeight?.value).toBe(2000);
    expect(garbage?.openingWeight).toBeUndefined();
  });
});

describe('equipment hints', () => {
  it('keeps a station id that resolves, so the swap sheet lights up', () => {
    const parsed = parseCustomExercise({ name: 'Pulldown variant', stationId: 'latpulldownmachine' });

    expect(parsed?.stations?.[0]?.stationId).toBe('latpulldownmachine');
  });

  it('drops a station id that means nothing here, keeping the prose', () => {
    // An unrecognised hint costs the user nothing: `equipment` is the
    // authoritative description of what they need.
    const parsed = parseCustomExercise({
      name: 'Reformer work',
      stationId: 'pilates-reformer',
      equipment: 'Pilates reformer',
    });

    expect(parsed?.stations).toBeUndefined();
    expect(parsed?.equipment).toBe('Pilates reformer');
  });
});

describe('day references', () => {
  it('resolves ids against the built-in catalogue and the plan alike', () => {
    const { plan } = parsePortablePlan(
      minimalPlan({
        exercises: [{ id: 'sled-push', name: 'Sled push', loaded: true }],
        days: [
          {
            dayKey: 'mon',
            label: 'Mixed',
            type: 'strength',
            sub: '',
            note: '',
            outline: ['Go'],
            aerobic: false,
            exerciseIds: ['legpress', 'sled-push'],
          },
        ],
      }),
    );

    expect(plan?.days[0]?.exerciseIds).toEqual(['legpress', `${CUSTOM_ID_PREFIX}sled-push`]);
  });

  it('drops a reference that resolves to nothing at all', () => {
    const { plan } = parsePortablePlan(
      minimalPlan({
        days: [
          {
            dayKey: 'mon',
            label: 'Day',
            type: 'strength',
            sub: '',
            note: '',
            outline: ['Go'],
            aerobic: false,
            exerciseIds: ['legpress', 'invented-movement'],
          },
        ],
      }),
    );

    expect(plan?.days[0]?.exerciseIds).toEqual(['legpress']);
  });

  it('does not repeat a movement listed twice on one day', () => {
    const { plan } = parsePortablePlan(
      minimalPlan({
        days: [
          {
            dayKey: 'mon',
            label: 'Day',
            type: 'strength',
            sub: '',
            note: '',
            outline: ['Go'],
            aerobic: false,
            exerciseIds: ['legpress', 'legpress'],
          },
        ],
      }),
    );

    expect(plan?.days[0]?.exerciseIds).toEqual(['legpress']);
  });

  it('keeps paragraph breaks in a session note but flattens stray whitespace', () => {
    const { plan } = parsePortablePlan(
      minimalPlan({
        days: [
          {
            dayKey: 'mon',
            label: 'Day',
            type: 'rest',
            sub: '',
            note: 'First    paragraph.\n\n\n\nSecond one.',
            outline: ['Rest'],
            aerobic: false,
          },
        ],
      }),
    );

    expect(plan?.days[0]?.note).toBe('First paragraph.\n\nSecond one.');
  });
});
