/*
 * Printing is the point of this file, not a debugging leftover — the pass/fail
 * tells you a plan is valid, the output tells you whether it is any good. The
 * project bans `console.log` everywhere else for good reason; here it is the
 * deliverable.
 */
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolvePlan } from '@/data/activePlan';
import { resolveExercise } from '@/data/catalogue';
import { parsePortablePlan } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';
import { startingWeight } from '@/domain/startingWeights';

/**
 * A bench for checking a plan an LLM actually wrote.
 *
 * The rest of the suite tests the parser against inputs chosen to break it.
 * This one runs a real file through the whole pipeline — parse, validate,
 * resolve, price the opening sets — and prints what the app would show. It is
 * how you find out whether a model read `/llms.txt` properly, rather than
 * whether the parser survives being handed nonsense.
 *
 * ```bash
 * PLAN_PATH=./plan-from-chatgpt.json npx vitest run tests/planCheck.test.ts --disable-console-intercept
 * ```
 *
 * Skips itself when `PLAN_PATH` is unset, so CI is unaffected. Note that
 * `describe.skipIf` still *evaluates* its callback to collect the tests — it
 * only stops them running — so the file has to be read outside it, guarded.
 */
const PLAN_PATH = process.env['PLAN_PATH'] ?? '';

const source = PLAN_PATH ? readFileSync(PLAN_PATH, 'utf8') : '';
const { plan, error } = parsePortablePlan(source);

describe.skipIf(!PLAN_PATH)('a plan written by a language model', () => {
  it('parses', () => {
    if (error) console.log(`\nPARSE FAILED: ${error}`);
    expect(plan).not.toBeNull();
  });

  it('passes validation', () => {
    if (!plan) throw new Error('did not parse');
    const result = validatePlan(plan);

    console.log('\n--- VALIDATION ---');
    console.log(`ok: ${result.ok}`);
    console.log(`aerobic minutes: ${result.weeklyAerobicMinutes}`);
    console.log(`strength days: ${result.strengthDays}`);
    console.log(`movements it defined: ${result.customExercises}`);

    if (result.issues.length === 0) console.log('no issues');
    for (const issue of result.issues) {
      console.log(`  [${issue.severity}] ${issue.message}`);
    }

    expect(result.ok).toBe(true);
  });

  it('resolves into a renderable week', () => {
    if (!plan) throw new Error('did not parse');
    const resolved = resolvePlan(plan);

    console.log('\n--- WEEK AS THE APP WOULD SHOW IT ---');
    for (const key of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) {
      const day = resolved[key];
      const movements = (day.exercises ?? []).map((e) => e.name).join(', ');
      console.log(
        `${key}: ${day.label} (${day.type}${day.minutes ? `, ${day.minutes} min` : ''})` +
          (movements ? `\n     ${movements}` : ''),
      );

      expect(day.label, `${key} has no label`).toBeTruthy();
      expect(day.outline.length, `${key} has no outline`).toBeGreaterThan(0);
    }
  });

  it('gives every referenced movement a usable definition', () => {
    if (!plan) throw new Error('did not parse');

    console.log('\n--- MOVEMENTS ---');
    for (const id of new Set(plan.days.flatMap((day) => day.exerciseIds ?? []))) {
      const exercise = resolveExercise(id, { plan });
      expect(exercise, `nothing defines "${id}"`).toBeDefined();
      if (!exercise) continue;

      // No profile passed: this is the opening weight a brand-new user sees,
      // which is exactly the number an author's `openingWeight` is for.
      const opener = startingWeight(exercise, undefined, 'lb');

      console.log(
        `${exercise.id.padEnd(24)} ${exercise.repRange.padEnd(12)} ${exercise.sets} sets` +
          `  rest ${exercise.restSeconds}s` +
          `  ${exercise.loaded ? `opens at ${opener ?? 'nothing suggested'}` : 'bodyweight'}` +
          `  ${exercise.source === 'plan' ? '(defined by the plan)' : '(built-in)'}`,
      );
    }
  });
});
