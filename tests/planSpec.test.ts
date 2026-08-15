import { describe, expect, it } from 'vitest';

import { buildCatalog, buildLlmsTxt, buildPrompt } from '@/spec/planSpec';
import { ALL_EXERCISES } from '@/data/exercises';
import { ALL_STATIONS } from '@/data/equipment';
import { PLAN_FORMAT_VERSION, PLAN_KIND, parsePortablePlan } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';

/**
 * Guards on the LLM-facing contract.
 *
 * `/llms.txt` is the whole feature's interface: a model that reads it and gets
 * something wrong produces a plan the user cannot import, and the user has no
 * way to tell whose fault that was. So the tests here check the two things
 * documentation usually fails at — being complete, and being true.
 */

describe('catalog.json', () => {
  it('lists every built-in movement and station', () => {
    const catalog = buildCatalog() as {
      exercises: readonly { id: string }[];
      stations: readonly { id: string }[];
    };

    expect(catalog.exercises).toHaveLength(ALL_EXERCISES.length);
    expect(catalog.stations).toHaveLength(ALL_STATIONS.length);
  });
});

describe('llms.txt', () => {
  const spec = buildLlmsTxt();

  it('names every built-in exercise id, so a model can reference them', () => {
    for (const exercise of ALL_EXERCISES) {
      expect(spec, `spec omits exercise "${exercise.id}"`).toContain(`\`${exercise.id}\``);
    }
  });

  it('names every built-in station id', () => {
    for (const station of ALL_STATIONS) {
      expect(spec, `spec omits station "${station.id}"`).toContain(`\`${station.id}\``);
    }
  });

  it('states the envelope the parser actually requires', () => {
    expect(spec).toContain(PLAN_KIND);
    expect(spec).toContain(`Currently \`${PLAN_FORMAT_VERSION}\``);
  });

  it('documents every day field the parser reads', () => {
    for (const field of [
      'dayKey',
      'label',
      'type',
      'sub',
      'note',
      'outline',
      'aerobic',
      'minutes',
      'exerciseIds',
      'exerciseFormat',
      'rounds',
      'modalityStations',
      'modality',
    ]) {
      expect(spec, `spec omits day field "${field}"`).toContain(`\`${field}\``);
    }
  });

  it('documents every exercise field the parser reads', () => {
    for (const field of [
      'name',
      'summary',
      'equipment',
      'stationId',
      'sets',
      'repMin',
      'repMax',
      'repMetric',
      'loaded',
      'restSeconds',
      'alternative',
      'muscles',
      'tips',
      'openingWeight',
    ]) {
      expect(spec, `spec omits exercise field "${field}"`).toContain(`\`${field}\``);
    }
  });

  it('tells the model not to prescribe per-set loads', () => {
    // The single most important instruction in the document. A plan that
    // writes its own weights silently contradicts what progression.ts shows
    // the user on screen.
    expect(spec).toContain('Do not prescribe per-set weights');
  });

  it('says where opening weights are used and that they stop mattering', () => {
    expect(spec).toContain('openingWeight');
    expect(spec).toContain('used exactly once');
  });
});

describe('the prompt handed to the user', () => {
  it('carries the whole contract inline, not just a link', () => {
    // A link works beautifully in chat apps that can browse and fails silently
    // in the ones that cannot, producing a plan in some invented format the
    // user then cannot import and cannot debug.
    const prompt = buildPrompt({});

    expect(prompt).toContain('rackfile.plan');
    expect(prompt).toContain('Do not prescribe per-set weights');
    expect(prompt.length).toBeGreaterThan(buildLlmsTxt().length);
  });

  it('leads with the person, not the specification', () => {
    const prompt = buildPrompt({
      gym: 'Apartment gym, dumbbells to 50 lb',
      age: 41,
      bodyweight: 190,
      bodyweightUnit: 'lb',
      level: 'returning',
      conditions: ['high cholesterol'],
    });

    const aboutMe = prompt.indexOf('ABOUT ME');
    expect(aboutMe).toBeGreaterThan(-1);
    expect(aboutMe).toBeLessThan(prompt.indexOf('# Rack & File'));

    for (const detail of ['41', '190 lb', 'returning', 'high cholesterol', 'Apartment gym']) {
      expect(prompt).toContain(detail);
    }
  });

  it('asks the model to ask about equipment when the user has not said', () => {
    expect(buildPrompt({})).toContain('Ask me what equipment I have');
    expect(buildPrompt({ gym: 'Full commercial gym' })).not.toContain('Ask me what equipment I have');
  });

  it('names crossed-off equipment rather than claiming the rest is present', () => {
    const prompt = buildPrompt({ gym: 'A gym', missingEquipment: ['Squat rack', 'Pool — laps'] });

    expect(prompt).toContain('does NOT have: Squat rack, Pool — laps');
  });

  it('includes the site URL when one is known', () => {
    expect(buildPrompt({}, 'https://example.test')).toContain('https://example.test/llms.txt');
  });
});

describe('the worked example in llms.txt', () => {
  /**
   * The example is the part a model is likeliest to copy verbatim, so it has
   * to survive the real parser and the real validator. A specification whose
   * own example fails import is worse than none.
   */
  const example = extractLargestJsonBlock(buildLlmsTxt());

  it('parses with the real parser', () => {
    const { plan, error } = parsePortablePlan(example);

    expect(error).toBeNull();
    expect(plan).not.toBeNull();
  });

  it('produces the days and custom movement it claims to', () => {
    const { plan } = parsePortablePlan(example);

    expect(plan?.days.map((d) => d.dayKey)).toEqual(['mon', 'tue', 'wed']);
    expect(plan?.exercises?.[0]?.name).toBe('Dumbbell floor press');
    expect(plan?.exercises?.[0]?.openingWeight).toEqual({ value: 20, unit: 'lb' });
  });

  it('references its custom movement from the day that uses it', () => {
    const { plan } = parsePortablePlan(example);
    const monday = plan?.days.find((d) => d.dayKey === 'mon');

    expect(monday?.exerciseIds).toContain('x:db-floor-press');
    expect(monday?.exerciseIds).toContain('legpress');
  });

  it('raises only the missing-days errors a three-day excerpt should raise', () => {
    const { plan } = parsePortablePlan(example);
    if (!plan) throw new Error('the spec example did not parse');

    const result = validatePlan(plan);

    // Abbreviated on purpose, so four days are legitimately absent. Nothing
    // else should be wrong with it.
    const other = result.issues.filter(
      (issue) => issue.severity === 'error' && !issue.message.startsWith('Missing day'),
    );
    expect(other).toEqual([]);
  });
});

/** Pull the biggest fenced JSON block out of the spec — the worked example. */
function extractLargestJsonBlock(markdown: string): string {
  const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((block) => block.startsWith('{'))
    .sort((a, b) => b.length - a.length);

  return blocks[0] ?? '';
}
