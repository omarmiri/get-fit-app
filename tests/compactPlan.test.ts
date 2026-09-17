import { describe, expect, it } from 'vitest';
import { expandCompactPlan, looksCompact } from '@/domain/compactPlan';
import { parsePortablePlan } from '@/domain/planFormat';
import { validatePlan } from '@/domain/planValidation';

/**
 * The compact format exists for exactly one reason: to fit in a link.
 *
 * So the tests that matter most are not about fields — they are about size,
 * and about the format staying readable when a language model types it
 * slightly wrong. A parser that only accepts perfect input would move the
 * failure from "the plan did not import" to "the link did nothing", which is
 * worse, because the user cannot see why.
 */

/** A realistic week: seven days, built-in movements, one defined movement. */
const WEEK = [
  'rf1|Three lifting days around your knee, with walking between them',
  'by|ChatGPT',
  'sun|dur|l=Easy walk|m=30|d=treadmill|o=Walk at a pace you could talk at;Keep it flat',
  'mon|str|l=Full body A|e=chestpress,legpress,seatedrow|o=Five minutes easy cardio;Work through the lifts;Stretch',
  'tue|rest|l=Rest|o=Walk if you feel like it',
  'wed|str|l=Full body B|e=latpulldown,legcurl,shoulderpress|o=Warm up;Work through the lifts;Stretch',
  'thu|dur|l=Easy walk|m=30|d=outside|o=Thirty minutes at a conversational pace',
  'fri|str|l=Full body C|e=chestpress,legpress,x:sled-push|o=Warm up;Lifts then the sled;Stretch',
  'sat|rest|l=Rest|o=Nothing planned',
  'x|Sled push|d=Push a weighted sled the length of the turf|q=turf lane and a sled|s=4|r=20-30s|w=90lb',
].join('~');

/**
 * The line this format draws is behaviour before prose: anything the app
 * *computes* with has to survive the trip, whatever it costs, and anything the
 * user merely reads may be dropped or inherited.
 *
 * The first version got that wrong, and these are the tests that would have
 * caught it.
 */
describe('fields the app computes with', () => {
  it('carries inverseLoad, because losing it runs progression backwards', () => {
    const { plan } = parsePortablePlan('rf1~x|Band-assisted pull-up|w=60lb|i=1~mon|str|e=x:band-assisted-pull-up|o=Pull');

    expect(plan?.exercises?.[0]?.inverseLoad).toBe(true);
  });

  it('does not invent inverseLoad when it was not stated', () => {
    const { plan } = parsePortablePlan('rf1~x|Sled push|w=90lb~mon|str|e=x:sled-push|o=Push');

    expect(plan?.exercises?.[0]?.inverseLoad).toBeUndefined();
  });

  it('carries a rest interval that is not the default', () => {
    const { plan } = parsePortablePlan('rf1~x|Heavy carry|w=70lb|rest=180~mon|str|e=x:heavy-carry|o=Carry');

    expect(plan?.exercises?.[0]?.restSeconds).toBe(180);
  });

  it('carries a station hint, and puts it ahead of anything inherited', () => {
    const { plan } = parsePortablePlan(
      'rf1~x|Paused leg press|like=legpress|st=isochestpress~mon|str|e=x:paused-leg-press|o=Press',
    );
    const stations = plan?.exercises?.[0]?.stations?.map((station) => station.stationId);

    // The head of the list is the default and the tail is what the swap sheet
    // offers, so an explicitly named station has to lead.
    expect(stations?.[0]).toBe('isochestpress');
    expect(stations).toContain('legpressmachine');
  });
});

describe('inheriting from a built-in movement', () => {
  it('takes the cues, rest and rep metric of the movement it names', () => {
    const { plan } = parsePortablePlan('rf1~x|Single-arm lat pulldown|like=latpulldown~mon|str|e=x:single-arm-lat-pulldown|o=Pull');
    const movement = plan?.exercises?.[0];

    expect(movement?.name).toBe('Single-arm lat pulldown');
    expect(movement?.cues.setup).toBeTruthy();
    expect(movement?.cues.execute).toBeTruthy();
    expect(movement?.restSeconds).toBeGreaterThan(0);
    expect(movement?.loaded).toBe(true);
  });

  /*
   * The case this feature is really for. A model that forgets `i=1` on a
   * band-assisted pull-up has written a plan that pushes the user the wrong
   * way; naming the built-in it resembles makes that impossible to forget.
   */
  it('carries the load direction of an assisted machine without being told', () => {
    const { plan } = parsePortablePlan('rf1~x|Band-assisted pull-up|like=assistedpullup~mon|str|e=x:band-assisted-pull-up|o=Pull');

    expect(plan?.exercises?.[0]?.inverseLoad).toBe(true);
    expect(plan?.exercises?.[0]?.loaded).toBe(true);
  });

  it('lets anything stated explicitly win over what it inherited', () => {
    const { plan } = parsePortablePlan(
      'rf1~x|Slow lat pulldown|like=latpulldown|d=Pull the bar down over four seconds|rest=150|s=5|r=6-8~mon|str|e=x:slow-lat-pulldown|o=Pull',
    );
    const movement = plan?.exercises?.[0];

    expect(movement?.summary).toBe('Pull the bar down over four seconds');
    expect(movement?.restSeconds).toBe(150);
    expect(movement?.sets).toBe(5);
    expect(movement?.repMin).toBe(6);
    expect(movement?.repMax).toBe(8);
    // Still inherited, because it was not overridden.
    expect(movement?.cues.setup).toBeTruthy();
  });

  it('ignores a base that does not exist rather than failing the movement', () => {
    const { plan } = parsePortablePlan('rf1~x|Sled push|like=notathing|d=Push a sled~mon|str|e=x:sled-push|o=Push');

    expect(plan?.exercises?.[0]?.name).toBe('Sled push');
    expect(plan?.exercises?.[0]?.summary).toBe('Push a sled');
  });

  /*
   * A plan that defines a movement and then names it means its own — the
   * definition shadows the catalogue for that plan, which is the right
   * precedence for an author who went to the trouble of writing one.
   *
   * What it cannot do is *become* the built-in. The definition is namespaced
   * under `x:`, so the catalogue's `legpress` keeps its meaning, and every set
   * already logged against it still refers to the same movement. That is the
   * invariant worth pinning: shadowing is a plan's business, rewriting history
   * is not.
   */
  it('shadows a built-in name within its own plan without becoming it', () => {
    const { plan } = parsePortablePlan('rf1~x|Legpress|like=legpress~mon|str|e=legpress|o=Press');

    expect(plan?.exercises?.[0]?.id).toBe('x:legpress');
    expect(plan?.days[0]?.exerciseIds).toEqual(['x:legpress']);
  });
});

describe('the premise', () => {
  /*
   * The number this whole format is built around. A plan in JSON is 6–12kb,
   * which no chat window renders as a link; if this ever creeps past a couple
   * of kilobytes encoded, the link stops being tappable and the format has
   * quietly lost its only advantage over pasting JSON.
   */
  it('fits in a link with room to spare', () => {
    const url = `https://fitness.miriogames.com/#plan=${encodeURIComponent(WEEK)}`;

    expect(WEEK.length).toBeLessThan(1000);
    expect(url.length).toBeLessThan(2000);
  });

  it('survives the round trip a link puts it through', () => {
    const throughUrl = new URL(`https://x.test/#plan=${encodeURIComponent(WEEK)}`);
    const back = decodeURIComponent(throughUrl.hash.replace('#plan=', ''));

    expect(back).toBe(WEEK);
  });
});

describe('expandCompactPlan', () => {
  it('produces a week the ordinary parser and validator both accept', () => {
    const { plan, error } = parsePortablePlan(WEEK);

    expect(error).toBeNull();
    expect(plan?.days).toHaveLength(7);
    expect(validatePlan(plan!, { missingStationIds: [] }).ok).toBe(true);
  });

  it('keeps the summary, the author and the day labels', () => {
    const { plan } = parsePortablePlan(WEEK);

    expect(plan?.summary).toContain('knee');
    expect(plan?.model).toBe('ChatGPT');
    expect(plan?.days.map((day) => day.label)).toContain('Full body A');
  });

  it('reads outlines, minutes and exercise ids', () => {
    const { plan } = parsePortablePlan(WEEK);
    const mon = plan?.days.find((day) => day.dayKey === 'mon');
    const sun = plan?.days.find((day) => day.dayKey === 'sun');

    expect(mon?.exerciseIds).toEqual(['chestpress', 'legpress', 'seatedrow']);
    expect(mon?.outline).toHaveLength(3);
    expect(sun?.minutes).toBe(30);
  });

  it('marks cardio days aerobic and lifting days not, without being told', () => {
    const { plan } = parsePortablePlan(WEEK);
    const aerobic = Object.fromEntries(plan!.days.map((day) => [day.dayKey, day.aerobic]));

    expect(aerobic['sun']).toBe(true);
    expect(aerobic['mon']).toBe(false);
    expect(aerobic['sat']).toBe(false);
  });

  it('lets an author say a timed day is not aerobic', () => {
    const plan = expandCompactPlan('rf1~mon|dur|l=Mobility|m=20|a=0|o=Stretch');

    expect((plan?.['days'] as Record<string, unknown>[])[0]?.['aerobic']).toBe(false);
  });

  it('resolves a station id, and passes anything else through as plain English', () => {
    const { plan } = parsePortablePlan(WEEK);
    const sun = plan?.days.find((day) => day.dayKey === 'sun');
    const thu = plan?.days.find((day) => day.dayKey === 'thu');

    expect(sun?.modalityStations).toEqual(['treadmill']);
    expect(sun?.modality).toBeUndefined();
    expect(thu?.modality).toBe('outside');
  });
});

describe('defined movements', () => {
  it('carries enough to render one', () => {
    const { plan } = parsePortablePlan(WEEK);
    const sled = plan?.exercises?.find((exercise) => exercise.name === 'Sled push');

    expect(sled?.id).toBe('x:sled-push');
    expect(sled?.summary).toContain('turf');
    expect(sled?.equipment).toContain('sled');
    expect(sled?.sets).toBe(4);
    expect(sled?.repMetric).toBe('seconds');
    expect(sled?.repMin).toBe(20);
  });

  it('treats an opening weight as the signal that a movement is loaded', () => {
    const loaded = parsePortablePlan('rf1~x|Sled push|w=90lb~mon|str|e=x:sled-push|o=Push');
    const bodyweight = parsePortablePlan('rf1~x|Push-up|q=the floor~mon|str|e=x:push-up|o=Push');

    expect(loaded.plan?.exercises?.[0]?.loaded).toBe(true);
    expect(loaded.plan?.exercises?.[0]?.openingWeight).toEqual({ value: 90, unit: 'lb' });
    expect(bodyweight.plan?.exercises?.[0]?.loaded).toBe(false);
  });

  it('reads kilograms when they are what the author wrote', () => {
    const { plan } = parsePortablePlan('rf1~x|Front squat|w=40kg~mon|str|e=x:front-squat|o=Squat');

    expect(plan?.exercises?.[0]?.openingWeight).toEqual({ value: 40, unit: 'kg' });
  });
});

/**
 * Everything below is a mistake a model actually makes. Each one is worth a
 * default rather than a refusal, because the alternative is a link that opens
 * the app and shows nothing.
 */
describe('tolerating how a model really writes it', () => {
  it('accepts newlines where the separator should be', () => {
    const { plan } = parsePortablePlan(WEEK.split('~').join('\n'));

    expect(plan?.days).toHaveLength(7);
  });

  it('accepts a fenced block, because a model shown a line format will fence it', () => {
    const { plan } = parsePortablePlan(`Here is your week:\n\n\`\`\`\n${WEEK}\n\`\`\`\n\nEnjoy.`);

    expect(plan?.days).toHaveLength(7);
  });

  it('accepts text that still carries its percent-encoding', () => {
    const { plan } = parsePortablePlan(encodeURIComponent(WEEK));

    expect(plan?.days).toHaveLength(7);
  });

  it('takes an unkeyed field as the label', () => {
    const plan = expandCompactPlan('rf1~mon|str|Full body A|e=legpress|o=Lift');

    expect((plan?.['days'] as Record<string, unknown>[])[0]?.['label']).toBe('Full body A');
  });

  it('ignores a key it does not know rather than dropping the day', () => {
    const plan = expandCompactPlan('rf1~mon|str|l=Lifting|intensity=hard|e=legpress|o=Lift');
    const day = (plan?.['days'] as Record<string, unknown>[])[0];

    expect(day?.['label']).toBe('Lifting');
    expect(day?.['exerciseIds']).toEqual(['legpress']);
  });

  it('accepts the long spelling of a session type', () => {
    const plan = expandCompactPlan('rf1~mon|strength|l=Lifting|e=legpress|o=Lift');

    expect((plan?.['days'] as Record<string, unknown>[])[0]?.['type']).toBe('strength');
  });

  it('skips a record it cannot read instead of failing the week', () => {
    const { plan } = parsePortablePlan(`${WEEK}~notaday|str|l=Nonsense`);

    expect(plan?.days).toHaveLength(7);
  });
});

describe('what it refuses', () => {
  it('does not claim text that is not this format', () => {
    expect(expandCompactPlan('{"kind":"rackfile.plan","days":[]}')).toBeNull();
    expect(expandCompactPlan('Sure, here is a training plan for you.')).toBeNull();
    expect(looksCompact('reformat this')).toBe(false);
  });

  it('leaves JSON to the JSON parser', () => {
    const { plan } = parsePortablePlan(
      JSON.stringify({
        kind: 'rackfile.plan',
        days: [{ dayKey: 'mon', label: 'Push', type: 'strength', exerciseIds: ['chestpress'] }],
      }),
    );

    expect(plan?.days).toHaveLength(1);
  });

  /*
   * The separators are the format's only hard rule, so a value containing one
   * has to fail predictably. It splits — which costs that one field — rather
   * than corrupting the record around it or letting an author reach into a
   * field they were not writing.
   */
  it('splits on a separator inside a value rather than swallowing the record', () => {
    const plan = expandCompactPlan('rf1~mon|str|l=Push | pull|e=legpress|o=Lift');
    const day = (plan?.['days'] as Record<string, unknown>[])[0];

    expect(day?.['label']).toBe('Push');
    expect(day?.['exerciseIds']).toEqual(['legpress']);
  });
});
