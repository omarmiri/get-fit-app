import type { Station, StationKind, Zone } from '@/types';

/**
 * A vocabulary of common gym equipment.
 *
 * ## What this list is, and what it is not
 *
 * It is *not* an inventory. The app has no way to know what is on any
 * particular gym floor, and an earlier version of this file pretended
 * otherwise — it described one specific club, split by how confident it was
 * that each machine was really there. That was honest about its uncertainty
 * but wrong about its job: it made the app a directory of one building.
 *
 * What this list actually does is give the app a shared name for equipment, so
 * that a built-in exercise can say "this is normally done on a lat pulldown,
 * and here is what else trains the same thing" — the station swap sheet and
 * the load-conversion factors in `domain/substitutions.ts`.
 *
 * Two consequences:
 *
 * - Every station is assumed possibly-present. `Preferences.missingStations`
 *   is the only record of what a given user's gym lacks, and it is written by
 *   the user, from the floor.
 * - Imported plans are not limited to these ids. An LLM writing a plan
 *   describes equipment in plain English; a station id is an optional hint
 *   that, when it happens to match, lights up the swap sheet as a bonus.
 */

/** Human labels for zones, used to tell the user where to walk. */
export const ZONE_LABEL: Readonly<Record<Zone, string>> = {
  'cardio-floor': 'Cardio floor',
  'cardio-cinema': 'Cardio cinema',
  'strength-machines': 'Machine circuit',
  'free-weights': 'Free weights',
  'cable-area': 'Cables',
  turf: 'Turf',
  'stretch-area': 'Stretch area',
  pool: 'Pool',
  courts: 'Courts',
  studio: 'Studio',
  'locker-room': 'Locker room',
};

function station(
  id: string,
  name: string,
  kind: StationKind,
  zone: Zone,
  extra: Partial<Station> = {},
): Station {
  return { id, name, kind, zone, ...extra };
}

/* ------------------------------------------------------------------ cardio */

const CARDIO: readonly Station[] = [
  station('treadmill', 'Treadmill', 'cardio', 'cardio-floor', {
    note: 'Usually the most numerous machine on the floor — something is often free.',
  }),
  station('elliptical', 'Elliptical', 'cardio', 'cardio-floor', {
    note: 'Low impact. Good default when knees or hips are complaining.',
  }),
  station('arctrainer', 'Arc trainer', 'cardio', 'cardio-floor', {
    note: 'Stride feels between an elliptical and a stair climber.',
  }),
  station('uprightbike', 'Upright bike', 'cardio', 'cardio-floor'),
  station('recumbentbike', 'Recumbent bike', 'cardio', 'cardio-floor', {
    note: 'Back support. The easiest option on a recovery day.',
  }),
  station('stairmill', 'Stair mill', 'cardio', 'cardio-floor', {
    note: 'Hardest of the cardio machines for a given speed setting. Pace yourself.',
  }),
  station('rower', 'Rowing machine', 'cardio', 'cardio-floor', {
    note: 'Full body. Drive with the legs first, then the back, then the arms.',
  }),
  station('cardiocinema', 'Theatre cardio room', 'cardio', 'cardio-cinema', {
    note: 'Darkened room of treadmills and ellipticals, where a gym has one. Good for long steady work.',
  }),
  station('poollaps', 'Pool — laps', 'water', 'pool', {
    note: 'Check the posted lane schedule; lanes get shared at peak times.',
  }),
  station('poolwalk', 'Pool — water walking', 'water', 'pool', {
    note: 'Shallow end. Zero impact, and the water does the cooling for you.',
  }),
  station('basketball', 'Basketball court', 'court', 'courts', {
    note: 'Open shooting counts as cardio. Check for scheduled play.',
  }),
  station('racquetball', 'Racquetball court', 'court', 'courts', {
    note: 'Often needs booking at the front desk. Intense — treat it as an intervals day.',
  }),
];

/* ---------------------------------------------------------------- strength */

const STRENGTH: readonly Station[] = [
  // Legs
  station('legpressmachine', 'Leg press', 'plate-loaded', 'strength-machines', {
    note: 'Angled sled. Load is usually plates per side, not total.',
  }),
  station('hacksquat', 'Hack squat', 'plate-loaded', 'strength-machines', {
    note: 'More quad-dominant than the leg press and harder on the knees. Start light.',
  }),
  station('legextension', 'Leg extension', 'selectorized', 'strength-machines'),
  station('seatedlegcurl', 'Seated leg curl', 'selectorized', 'strength-machines'),
  station('lyinglegcurl', 'Lying leg curl', 'selectorized', 'strength-machines'),
  station('smithmachine', 'Smith machine', 'rack', 'free-weights', {
    note: 'Fixed bar path. Useful when you want to push close to failure alone.',
  }),
  station('squatrack', 'Squat rack', 'rack', 'free-weights', {
    note: 'Set the safety pins before you load the bar.',
  }),
  station('olympicplatform', 'Olympic lifting platform', 'rack', 'free-weights'),

  // Push
  station('chestpressmachine', 'Chest press machine', 'selectorized', 'strength-machines'),
  station('isochestpress', 'Iso-lateral chest press', 'plate-loaded', 'strength-machines', {
    note: 'Each arm loads independently, so a strong side cannot carry a weak one.',
  }),
  station('inclinepressmachine', 'Incline press machine', 'plate-loaded', 'strength-machines'),
  station('pecdeck', 'Pec deck / chest fly', 'selectorized', 'strength-machines'),
  station('shoulderpressmachine', 'Shoulder press machine', 'selectorized', 'strength-machines'),
  station('dipstation', 'Dip / assisted dip station', 'bodyweight', 'strength-machines', {
    note: 'The assisted version counterweights you — a higher number means easier.',
  }),

  // Pull
  station('latpulldownmachine', 'Lat pulldown', 'cable', 'cable-area'),
  station('seatedrowmachine', 'Seated cable row', 'cable', 'cable-area'),
  station('isorow', 'Iso-lateral row', 'plate-loaded', 'strength-machines', {
    note: 'Chest-supported, so the low back stays out of it.',
  }),
  station('assistedpullup', 'Assisted pull-up', 'bodyweight', 'strength-machines', {
    note: 'Counterweighted. A higher setting takes more of your bodyweight off.',
  }),
  station('backextension', 'Back extension', 'bodyweight', 'strength-machines'),

  // Cables and free weights
  station('cablecrossover', 'Cable crossover', 'cable', 'cable-area', {
    note: 'Two adjustable stacks. Stands in for a lot of machines when they are busy.',
  }),
  station('functionaltrainer', 'Functional trainer', 'cable', 'cable-area'),
  station('dumbbells', 'Dumbbells', 'free-weight', 'free-weights', {
    note: 'The universal fallback. Rarely all taken at once.',
  }),
  station('barbell', 'Barbell', 'free-weight', 'free-weights'),
  station('kettlebells', 'Kettlebells', 'free-weight', 'turf'),
  station('flatbench', 'Flat bench', 'bench', 'free-weights'),
  station('adjustablebench', 'Adjustable bench', 'bench', 'free-weights', {
    note: 'About 30° for incline pressing — past 45° it becomes a shoulder press.',
  }),
];

/* ------------------------------------------------------- core and mobility */

const CORE_MOBILITY: readonly Station[] = [
  station('turfarea', 'Turf area', 'open-space', 'turf', {
    note: 'Space for carries, sleds, med balls and floor work.',
  }),
  station('stretcharea', 'Stretch area', 'open-space', 'stretch-area', {
    note: 'Mats and space to lie down. Where the core and mobility work belongs.',
  }),
  station('mat', 'Exercise mat', 'bodyweight', 'stretch-area'),
  station('abbench', 'Ab / decline bench', 'bench', 'strength-machines'),
  station('captainschair', 'Captain’s chair', 'bodyweight', 'strength-machines', {
    note: 'Vertical knee raise. Back flat against the pad.',
  }),
  station('abmachine', 'Ab crunch machine', 'selectorized', 'strength-machines'),
  station('stabilityball', 'Stability ball', 'bodyweight', 'stretch-area'),
  station('foamroller', 'Foam roller', 'bodyweight', 'stretch-area', {
    note: 'Slow passes. Spend longest where it is least comfortable.',
  }),
  station('medicineball', 'Medicine ball', 'free-weight', 'turf'),
  station('sauna', 'Sauna', 'open-space', 'locker-room', {
    note: 'Hydrate first; it does not replace the session.',
  }),
  station('spa', 'Spa / whirlpool', 'water', 'pool'),
];

/* ---------------------------------------------------------------- registry */

export const ALL_STATIONS: readonly Station[] = [...CARDIO, ...STRENGTH, ...CORE_MOBILITY];

const BY_ID = new Map<string, Station>(ALL_STATIONS.map((s) => [s.id, s]));

/** Resolve a station by id. Returns `undefined` for ids no longer in the catalogue. */
export function getStation(id: string): Station | undefined {
  return BY_ID.get(id);
}

/** A station's display name, falling back to the raw id for retired entries. */
export function stationName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

/** Where to find a station, e.g. `Cables`. */
export function stationZoneLabel(id: string): string {
  const found = BY_ID.get(id);
  return found ? ZONE_LABEL[found.zone] : '';
}
