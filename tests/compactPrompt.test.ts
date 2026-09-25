import { describe, expect, it } from 'vitest';

import { COMPACT_EXAMPLE, buildCompactPrompt, buildPrompt } from '@/spec/planSpec';
import { parsePortablePlan } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';

/*
 * The prompt "Copy the prompt" hands over. It replaced a 30K-character one,
 * so its size is the point, and its example is what a model imitates — so the
 * example has to be a week the app accepts without a single complaint.
 */

const SITE = 'https://fitness.miriogames.com';
const PERSON = {
  gym: 'Large commercial gym with barbells, machines, cables and dumbbells',
  likes: 'Chest, back and arms; working toward 20 pull-ups',
  age: 45,
  bodyweight: 190,
  bodyweightUnit: 'lb',
  level: 'returning',
};

describe('the compact prompt', () => {
  it('is a fraction of the full one', () => {
    const compact = buildCompactPrompt(PERSON, SITE);

    expect(compact.length).toBeLessThan(7000);
    expect(compact.length * 4).toBeLessThan(buildPrompt(PERSON, SITE).length);
  });

  it('carries the person, the format, the rules and every id', () => {
    const compact = buildCompactPrompt(PERSON, SITE);

    for (const needle of [
      'Large commercial gym',
      'rf1|',
      'Exactly seven day records',
      'legpress',
      'treadmill',
    ]) {
      expect(compact).toContain(needle);
    }
  });

  it('shows an example the app accepts without a single note', () => {
    const parsed = parsePortablePlan(COMPACT_EXAMPLE);
    const validation = parsed.plan ? validatePlan(parsed.plan) : null;

    expect(parsed.incomplete).toEqual([]);
    expect(validation?.ok).toBe(true);
    expect(validation?.issues).toEqual([]);
  });
});

describe('pasting a whole reply', () => {
  it('finds the plan inside its "Open in Rack & File" link', () => {
    const reply = `Here is your week! It balances strength and cardio.

[Open in Rack & File](${SITE}/#plan=${encodeURIComponent(COMPACT_EXAMPLE)})

Let me know if you want changes.`;

    expect(parsePortablePlan(reply).plan?.days).toHaveLength(7);
  });
});
