import type { Exercise } from '@/types';

/**
 * The exercise catalogue.
 *
 * `id` is a permanent persistence key — logged sets reference it, so renaming an
 * exercise is free but changing an id orphans a user's history. If you must
 * change one, add an entry to `EXERCISE_ID_ALIASES` in `state/migrations.ts`.
 *
 * To add exercise photos, clips or extra coaching notes, fill in the optional
 * `media` and `tips` fields. Nothing else needs to change: the exercise card
 * renders them when present and stays quiet when absent.
 */

/* ------------------------------------------------------------- strength A */

const LEG_PRESS: Exercise = {
  id: 'legpress',
  name: 'Leg press',
  alternative: 'Goblet squat',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Quads', 'Glutes'],
  equipment: ['Leg press machine'],
  cues: {
    setup: 'Feet shoulder-width, mid-platform. Whole back flat against the pad, hips deep in the seat.',
    execute:
      'Lower until knees reach about 90°. Drive through the middle of the foot. Stop just short of locking the knees.',
    avoid: 'Letting the low back peel off the pad at the bottom — that is your depth limit, not knee angle.',
  },
  tips: [
    'Feet higher on the platform shifts work toward the glutes and hamstrings; lower emphasises the quads.',
    'If your knees ache, narrow the stance slightly and cut the depth before you cut the load.',
  ],
};

const CHEST_PRESS: Exercise = {
  id: 'chestpress',
  name: 'Chest press',
  alternative: 'Incline push-up',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Chest', 'Triceps', 'Front delts'],
  equipment: ['Chest press machine'],
  cues: {
    setup: 'Set the seat so the handles line up with mid-chest. Feet flat, shoulder blades pinned back.',
    execute: 'Elbows about 45° from the torso. Press smooth, take two seconds to come back.',
    avoid: 'Shrugging the shoulders up toward the ears as you press.',
  },
  tips: ['The slow return is where most of the growth comes from. Do not let the stack drop.'],
};

const SEATED_ROW: Exercise = {
  id: 'seatedrow',
  name: 'Seated row',
  alternative: 'Chest-supported row',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Lats', 'Mid-back', 'Biceps'],
  equipment: ['Row machine', 'Cable stack'],
  cues: {
    setup: 'Chest against the pad if the machine has one. Slight knee bend, tall spine.',
    execute: 'Pull the elbows back past the ribs, squeeze the shoulder blades, resist on the way out.',
    avoid: 'Rocking the torso back and forth to move the weight.',
  },
  tips: ['Think about starting the pull with the shoulder blade, not the hand.'],
};

const RDL: Exercise = {
  id: 'rdl',
  name: 'Romanian deadlift',
  alternative: 'Dumbbell RDL',
  sets: 3,
  repRange: '8–10',
  defaultReps: 8,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Hamstrings', 'Glutes', 'Low back'],
  equipment: ['Dumbbells', 'Barbell'],
  cues: {
    setup: 'Dumbbells at the thighs, feet hip-width, knees soft — not locked, not bent.',
    execute:
      'Push the hips straight back, keep the dumbbells brushing the legs, stop when the hamstrings tighten.',
    avoid: 'Turning it into a squat by bending the knees instead of hinging the hips.',
  },
  tips: [
    'Range of motion is set by your hamstrings, not by the floor. Stop where the stretch stops, even if that is above the knee.',
  ],
};

const SHOULDER_PRESS: Exercise = {
  id: 'shoulderpress',
  name: 'Shoulder press',
  alternative: 'Dumbbell, seated',
  sets: 2,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 75,
  muscles: ['Shoulders', 'Triceps'],
  equipment: ['Dumbbells'],
  cues: {
    setup: 'Seated with back support. Dumbbells at ear height, palms forward.',
    execute: 'Ribs down, press up and slightly in, finish with the arms straight overhead.',
    avoid: 'Flaring the ribcage and arching the low back to finish the rep.',
  },
};

const LAT_PULLDOWN: Exercise = {
  id: 'latpulldown',
  name: 'Lat pulldown',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Lats', 'Biceps'],
  equipment: ['Pulldown machine'],
  cues: {
    setup: 'Thighs snug under the pads. Grip just outside shoulder width.',
    execute: 'Chest up, pull the bar to the collarbone by driving the elbows down toward the floor.',
    avoid: 'Leaning far back and using bodyweight momentum.',
  },
};

/* ------------------------------------------------------------- strength B */

const SPLIT_SQUAT: Exercise = {
  id: 'splitsquat',
  name: 'Split squat',
  alternative: 'Step-up',
  sets: 3,
  repRange: '8–10 / leg',
  defaultReps: 8,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Quads', 'Glutes'],
  equipment: ['Dumbbells'],
  cues: {
    setup: 'Long stance, back heel up. Hold dumbbells at the sides or one at the chest.',
    execute:
      'Drop the back knee straight down, keep the front shin near vertical, drive up through the front heel.',
    avoid: 'A stance so short that the front knee shoots way past the toes.',
  },
  tips: ['Log the reps for one leg. The set is both legs — the number is per side.'],
};

const INCLINE_PRESS: Exercise = {
  id: 'inclinepress',
  name: 'Incline dumbbell press',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Upper chest', 'Front delts', 'Triceps'],
  equipment: ['Dumbbells', 'Adjustable bench'],
  cues: {
    setup: 'Bench at about 30°. Dumbbells at the lower chest, wrists stacked over elbows.',
    execute: 'Press up and slightly together. Lower under control until you feel a stretch across the chest.',
    avoid: 'Setting the bench too steep — past 45° it becomes a shoulder press.',
  },
};

const CABLE_ROW: Exercise = {
  id: 'cablerow',
  name: 'Cable row',
  sets: 3,
  repRange: '8–12',
  defaultReps: 10,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 90,
  muscles: ['Mid-back', 'Lats', 'Biceps'],
  equipment: ['Cable stack'],
  cues: {
    setup: 'Feet braced, slight knee bend, sit tall with a neutral spine.',
    execute: 'Lead with the elbows, pull to the belly button, pause for a beat at the back.',
    avoid: 'Letting the shoulders roll forward at the end of the stretch.',
  },
};

const GLUTE_BRIDGE: Exercise = {
  id: 'glutebridge',
  name: 'Glute bridge',
  alternative: 'Hamstring curl',
  sets: 3,
  repRange: '10–12',
  defaultReps: 12,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 75,
  muscles: ['Glutes', 'Hamstrings'],
  equipment: ['Bench', 'Dumbbell (optional)'],
  cues: {
    setup: 'Shoulders on a bench or back on the floor, heels close to the hips.',
    execute:
      'Squeeze the glutes and lift until the hips line up with the knees and shoulders. Pause at the top.',
    avoid: 'Arching the low back at the top instead of finishing with the glutes.',
  },
  tips: ['Leave the weight at zero if you are doing these unloaded — the log handles bodyweight fine.'],
};

const LATERAL_RAISE: Exercise = {
  id: 'lateralraise',
  name: 'Lateral raise',
  sets: 2,
  repRange: '10–15',
  defaultReps: 12,
  repMetric: 'reps',
  loaded: true,
  restSeconds: 60,
  muscles: ['Side delts'],
  equipment: ['Dumbbells'],
  cues: {
    setup: 'Light dumbbells, small forward lean, slight bend in the elbows.',
    execute: 'Lift out to the sides to shoulder height, lead with the elbows, lower slowly.',
    avoid: 'Going too heavy and swinging — this one is a control exercise.',
  },
};

const FARMER_CARRY: Exercise = {
  id: 'farmercarry',
  name: 'Farmer carry',
  sets: 3,
  repRange: '20–30 sec',
  defaultReps: 25,
  repMetric: 'seconds',
  loaded: true,
  restSeconds: 60,
  muscles: ['Grip', 'Core', 'Traps'],
  equipment: ['Dumbbells'],
  cues: {
    setup: 'Heavy dumbbells at the sides. Stand tall, shoulders back and down.',
    execute: 'Walk with short controlled steps, ribs stacked over hips, breathe normally.',
    avoid: 'Leaning to one side because the load is uneven or too heavy.',
  },
  tips: ['Log the carry time in seconds and the weight of a single dumbbell.'],
};

/* ------------------------------------------------------------------- core */

const PLANK: Exercise = {
  id: 'plank',
  name: 'Plank',
  sets: 3,
  repRange: '20–30 sec',
  defaultReps: 25,
  repMetric: 'seconds',
  loaded: false,
  restSeconds: 45,
  muscles: ['Core'],
  equipment: ['Mat'],
  cues: {
    setup: 'Elbows under shoulders, feet hip-width.',
    execute: 'Squeeze the glutes and brace the abs so the body makes one straight line.',
    avoid: 'Letting the hips sag or pike up.',
  },
};

const DEAD_BUG: Exercise = {
  id: 'deadbug',
  name: 'Dead bug',
  sets: 3,
  repRange: '8–10 / side',
  defaultReps: 8,
  repMetric: 'reps',
  loaded: false,
  restSeconds: 45,
  muscles: ['Core'],
  equipment: ['Mat'],
  cues: {
    setup: 'On your back, arms up, knees over hips at 90°.',
    execute: 'Lower the opposite arm and leg slowly while keeping the low back flat on the floor.',
    avoid: 'Losing low-back contact with the floor — shorten the range instead.',
  },
};

const BIRD_DOG: Exercise = {
  id: 'birddog',
  name: 'Bird dog',
  sets: 3,
  repRange: '8–10 / side',
  defaultReps: 8,
  repMetric: 'reps',
  loaded: false,
  restSeconds: 45,
  muscles: ['Core', 'Glutes'],
  equipment: ['Mat'],
  cues: {
    setup: 'Hands under shoulders, knees under hips.',
    execute: 'Extend the opposite arm and leg, hold for a beat, keep the hips level the whole time.',
    avoid: 'Rotating the hips open as the leg goes back.',
  },
};

/* ---------------------------------------------------------------- groupings */

export const STRENGTH_A: readonly Exercise[] = [
  LEG_PRESS,
  CHEST_PRESS,
  SEATED_ROW,
  RDL,
  SHOULDER_PRESS,
  LAT_PULLDOWN,
];

export const STRENGTH_B: readonly Exercise[] = [
  SPLIT_SQUAT,
  INCLINE_PRESS,
  CABLE_ROW,
  GLUTE_BRIDGE,
  LATERAL_RAISE,
  FARMER_CARRY,
];

export const CORE: readonly Exercise[] = [PLANK, DEAD_BUG, BIRD_DOG];

/** Every exercise the app knows about, in a stable order. */
export const ALL_EXERCISES: readonly Exercise[] = [...STRENGTH_A, ...STRENGTH_B, ...CORE];

const BY_ID = new Map<string, Exercise>(ALL_EXERCISES.map((e) => [e.id, e]));

/**
 * Resolve an exercise by its persisted id.
 *
 * Returns `undefined` for ids that no longer exist in the catalogue, which
 * happens when an exercise is retired from the plan but history still
 * references it. Callers must handle that rather than assuming presence.
 */
export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/**
 * Exercises eligible for a one-rep-max trend: loaded movements measured in
 * reps. Estimating a 1RM from a 30-second plank would be nonsense.
 */
export function isTrendable(exercise: Exercise): boolean {
  return exercise.loaded && exercise.repMetric === 'reps';
}
