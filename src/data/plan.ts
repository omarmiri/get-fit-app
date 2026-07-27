import type { DayKey, Goals, PlanDay } from '@/types';
import { CORE, STRENGTH_A, STRENGTH_B } from './exercises';
import { PLATE } from './plates';

/**
 * The seven-day rotation.
 *
 * `aerobic: true` marks days whose logged minutes count toward the weekly
 * aerobic goal. Strength days are excluded even though they take time — the
 * 150-minute target is a cardiovascular one.
 */
export const PLAN: Readonly<Record<DayKey, PlanDay>> = {
  mon: {
    key: 'mon',
    label: 'Cardio + Core',
    type: 'mixed',
    color: PLATE.yellow,
    load: '15 kg',
    sub: '35–45 min steady cardio, then core',
    minutes: 45,
    aerobic: true,
    modalities: ['Treadmill', 'Elliptical', 'Bike'],
    exercises: CORE,
    note: 'Keep the cardio at a pace where you could still hold a conversation. Core work comes after, 2–3 rounds.',
  },
  tue: {
    key: 'tue',
    label: 'Strength A',
    type: 'strength',
    color: PLATE.red,
    load: '25 kg',
    sub: 'Full body · 45–60 min',
    aerobic: false,
    exercises: STRENGTH_A,
    note: 'Rest 60–90 seconds between sets. Stop each set one or two reps before your form breaks down.',
  },
  wed: {
    key: 'wed',
    label: 'Pool Recovery',
    type: 'duration',
    color: PLATE.green,
    load: '10 kg',
    sub: '30–40 min easy water work + mobility',
    minutes: 35,
    aerobic: true,
    modalities: ['Easy laps', 'Water walking', 'Aqua jog'],
    note: 'Easy effort only. Finish with 10 minutes of mobility for calves, hamstrings, hips, chest and upper back.',
  },
  thu: {
    key: 'thu',
    label: 'Cardio Intervals',
    type: 'intervals',
    color: PLATE.yellow,
    load: '15 kg',
    sub: '6–8 rounds · 30–40 min total',
    minutes: 35,
    aerobic: true,
    modalities: ['Bike', 'Elliptical', 'Treadmill incline'],
    note: '5 min easy warm-up. Then 1–2 min moderately hard, 2–3 min easy, repeated. 5 min cooldown. Controlled effort, not all-out.',
  },
  fri: {
    key: 'fri',
    label: 'Strength B',
    type: 'strength',
    color: PLATE.red,
    load: '25 kg',
    sub: 'Full body · 45–60 min',
    aerobic: false,
    exercises: STRENGTH_B,
    note: 'Same rules as Strength A. Different exercise selection to spread the load around.',
  },
  sat: {
    key: 'sat',
    label: 'Longer Cardio',
    type: 'duration',
    color: PLATE.blue,
    load: '20 kg',
    sub: '45–60 min low impact',
    minutes: 50,
    aerobic: true,
    modalities: ['Treadmill', 'Bike', 'Elliptical'],
    note: 'The long steady session. This is the one that does most of the work toward your weekly aerobic minutes.',
  },
  sun: {
    key: 'sun',
    label: 'Recovery',
    type: 'duration',
    color: PLATE.white,
    load: '5 kg',
    sub: '20–30 min easy movement',
    minutes: 25,
    aerobic: true,
    modalities: ['Easy walk', 'Stretching', 'Light pool'],
    note: 'Keep it light. Sauna afterwards is fine if it feels comfortable — hydrate first, and it does not replace the session.',
  },
};

/** Day keys in `Date#getDay()` order, so `DAY_KEYS[d.getDay()]` is valid. */
export const DAY_KEYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const satisfies readonly DayKey[];

/** Day keys in training-week order, Monday first, for the Plan tab listing. */
export const PLAN_ORDER = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const satisfies readonly DayKey[];

export const DAY_NAMES: Readonly<Record<DayKey, string>> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

/**
 * Weekly targets. 150 minutes matches the standard public-health guideline for
 * moderate aerobic activity; two strength sessions matches its resistance
 * training companion.
 */
export const GOALS: Goals = { minutes: 150, strength: 2 };

/** Look up a plan day. Returns `undefined` for unrecognised keys from old data. */
export function getPlanDay(key: string): PlanDay | undefined {
  return Object.hasOwn(PLAN, key) ? PLAN[key as DayKey] : undefined;
}

/** Whether a day key is one the plan recognises. */
export function isDayKey(value: unknown): value is DayKey {
  return typeof value === 'string' && Object.hasOwn(PLAN, value);
}
