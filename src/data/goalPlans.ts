import type { UserPlan, UserPlanDay } from '@/types';
import type { MainGoal } from '@/domain/gymProfile';

/**
 * A ready-made week for each main goal, for anyone who picked one and would
 * rather start training than open a chatbot.
 *
 * They are ordinary `UserPlan`s built from catalogue ids, so they resolve,
 * validate and substitute exactly like a plan a model wrote — and once
 * adopted they sit in the library like any other, renamable and deletable.
 * A fixed id per goal means adopting one twice replaces it rather than
 * filling the list with copies.
 *
 * "General fitness" has no entry: the built-in starter week already is that
 * plan — 150 cardio minutes and two strength days — and a second copy of it
 * under another name would only be something to tell apart. "Something else"
 * has none either, because there is nothing to guess from.
 */

export type StarterGoal = Exclude<MainGoal, 'general' | 'other'>;

interface GoalStarter {
  readonly name: string;
  readonly summary: string;
  readonly days: readonly UserPlanDay[];
}

const EASY_CARDIO = ['treadmill', 'recumbentbike', 'elliptical'] as const;

function rest(dayKey: UserPlanDay['dayKey']): UserPlanDay {
  return {
    dayKey,
    label: 'Rest',
    type: 'rest',
    sub: 'Nothing scheduled',
    note: 'A day off is part of the plan. A walk is fine if you feel like one.',
    outline: ['Rest — a short walk is fine if you feel like it'],
    aerobic: false,
  };
}

function strength(
  dayKey: UserPlanDay['dayKey'],
  label: string,
  sub: string,
  exerciseIds: readonly string[],
  note: string,
): UserPlanDay {
  return {
    dayKey,
    label,
    type: 'strength',
    sub,
    note,
    outline: [
      `${exerciseIds.length} movements, 2 to 3 sets each`,
      'Rest 60 to 90 seconds between sets',
      'Stretch — 5 minutes at the end',
    ],
    aerobic: false,
    exerciseIds,
    exerciseFormat: 'sets',
  };
}

function cardio(
  dayKey: UserPlanDay['dayKey'],
  label: string,
  minutes: number,
  outline: readonly string[],
  note: string,
  stations: readonly string[] = EASY_CARDIO,
  type: UserPlanDay['type'] = 'duration',
): UserPlanDay {
  return {
    dayKey,
    label,
    type,
    sub: `${minutes} min`,
    note,
    outline,
    aerobic: true,
    minutes,
    modalityStations: stations,
  };
}

const STARTERS: Readonly<Record<StarterGoal, GoalStarter>> = {
  routine: {
    name: 'Back into a routine starter',
    summary: 'Two short full-body sessions and three easy cardio days. Built to be kept, not to impress.',
    days: [
      strength(
        'mon',
        'Full Body A',
        'Five machines · about 30 min',
        ['legpress', 'chestpress', 'seatedrow', 'glutebridge', 'plank'],
        'Start lighter than you think. The goal this week is turning up, not the weight on the stack.',
      ),
      cardio(
        'tue',
        'Easy Cardio',
        25,
        ['Easy cardio — 25 minutes at a pace you could chat at', 'Stretch — 5 minutes'],
        'Conversational pace. If you can’t talk, slow down.',
      ),
      rest('wed'),
      strength(
        'thu',
        'Full Body B',
        'Five movements · about 30 min',
        ['gobletsquat', 'latpulldown', 'inclinepushup', 'rdl', 'deadbug'],
        'Same rule as Monday: finish every set feeling you had two or three more in you.',
      ),
      rest('fri'),
      cardio(
        'sat',
        'Longer Easy Cardio',
        35,
        ['One steady session — 35 minutes, low impact', 'Stretch — 5 minutes after'],
        'The longest session of the week, and still an easy one.',
      ),
      cardio(
        'sun',
        'Walk',
        20,
        ['A 20 minute walk, indoors or out'],
        'Light movement to round off the week.',
        ['treadmill'],
      ),
    ],
  },

  strength: {
    name: 'Build strength starter',
    summary: 'Three full-body strength days with a day between each, plus two easy cardio days for recovery.',
    days: [
      strength(
        'mon',
        'Strength A',
        'Full body · 45–60 min',
        ['legpress', 'dbbenchpress', 'seatedrow', 'rdl', 'shoulderpress', 'plank'],
        'Add weight when you hit the top of the rep range on every set with good form.',
      ),
      cardio(
        'tue',
        'Easy Cardio',
        30,
        ['Easy cardio — 30 minutes, conversational pace', 'Mobility — 5 minutes on hips and upper back'],
        'Recovery work. Keep it easy so Wednesday’s lifting isn’t compromised.',
      ),
      strength(
        'wed',
        'Strength B',
        'Full body · 45–60 min',
        ['splitsquat', 'latpulldown', 'inclinepress', 'hipthrust', 'cablerow', 'farmercarry'],
        'Different movements, same rules. Stop each set one or two reps before form breaks.',
      ),
      rest('thu'),
      strength(
        'fri',
        'Strength C',
        'Full body · 45–60 min',
        ['gobletsquat', 'chestpress', 'dbrow', 'glutebridge', 'lateralraise', 'sideplank'],
        'The lighter of the three. Chase clean reps rather than heavier weights.',
      ),
      cardio(
        'sat',
        'Easy Cardio',
        30,
        ['Easy cardio — 30 minutes, low impact', 'Stretch — 5 minutes after'],
        'Easy effort. This is here for your heart and your recovery, not to tire you out.',
      ),
      rest('sun'),
    ],
  },

  cardio: {
    name: 'Improve cardio starter',
    summary:
      'Four cardio days that build from steady to intervals to one long session, plus two strength days.',
    days: [
      cardio(
        'mon',
        'Steady Cardio',
        40,
        ['Steady cardio — 40 minutes, conversational pace', 'Stretch — 5 minutes'],
        'Steady and even. Most of your fitness gain comes from easy minutes like these.',
      ),
      strength(
        'tue',
        'Strength A',
        'Full body · 40–50 min',
        ['legpress', 'chestpress', 'seatedrow', 'rdl', 'shoulderpress', 'latpulldown'],
        'Strength keeps the running and cycling sustainable. Stop each set before form breaks.',
      ),
      cardio(
        'wed',
        'Cardio Intervals',
        30,
        ['5 minute easy warm-up', '6 rounds: 1 min hard, then 2 min easy', '5 minute cooldown, then stretch'],
        'Hard means breathing heavily, not sprinting all-out. Keep every round the same effort.',
        ['uprightbike', 'rower', 'treadmill'],
        'intervals',
      ),
      rest('thu'),
      strength(
        'fri',
        'Strength B',
        'Full body · 40–50 min',
        ['splitsquat', 'inclinepress', 'cablerow', 'glutebridge', 'lateralraise', 'farmercarry'],
        'Same rules as Tuesday, with different movements to spread the load.',
      ),
      cardio(
        'sat',
        'Long Cardio',
        50,
        ['One long steady session — 50 minutes', 'Stretch — 5 to 10 minutes after'],
        'The long one. Go slower than feels necessary so you can finish it.',
      ),
      cardio(
        'sun',
        'Recovery Cardio',
        30,
        ['Easy movement — 30 minutes, nothing strenuous', 'Mobility and stretching'],
        'Very easy. If your legs feel heavy, walk.',
        ['treadmill', 'recumbentbike', 'poolwalk'],
      ),
    ],
  },
};

/** Whether a goal has a starter week of its own. */
export function hasGoalStarter(goal: MainGoal | undefined): goal is StarterGoal {
  return goal !== undefined && Object.hasOwn(STARTERS, goal);
}

/** The starter week for a goal, as a plan ready to adopt. */
export function goalStarterPlan(goal: StarterGoal, now: number = Date.now()): UserPlan {
  const starter = STARTERS[goal];
  return {
    id: `starter-${goal}`,
    name: starter.name,
    summary: starter.summary,
    days: starter.days,
    generatedAt: now,
    model: 'Rack & File',
  };
}

/** What the starter for a goal is called, before it is adopted. */
export function goalStarterName(goal: StarterGoal): string {
  return STARTERS[goal].name;
}
