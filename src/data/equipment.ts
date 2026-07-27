import type { Station, StationKind, Zone } from '@/types';

/**
 * Equipment and spaces at the club.
 *
 * ## On the accuracy of this list
 *
 * Two tiers, and the difference matters:
 *
 * - `club-confirmed` — published for this specific club (LA Fitness Wayne, NJ,
 *   club 345) in its amenities listing: the pool, spa, sauna, basketball and
 *   racquetball courts, turf area, Olympic lifting platform, cardio cinema.
 *
 * - `chain-standard` — NOT verified for this club. LA Fitness does not publish
 *   per-club machine inventories and no third party does either. These entries
 *   are the chain's usual lineup (Life Fitness selectorized and cable, Hammer
 *   Strength plate-loaded) and are a starting point, not a fact.
 *
 * The app never hides that distinction: unconfirmed stations are labelled in
 * the swap sheet, and anything the user marks missing stops being suggested.
 * The floor corrects the data, not the other way round.
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
  confidence: Station['confidence'],
  extra: Partial<Station> = {},
): Station {
  return { id, name, kind, zone, confidence, ...extra };
}

/* ------------------------------------------------------------------ cardio */

const CARDIO: readonly Station[] = [
  station('treadmill', 'Treadmill', 'cardio', 'cardio-floor', 'chain-standard', {
    brand: 'Life Fitness',
    note: 'Most numerous machine on the floor — something is almost always free.',
  }),
  station('elliptical', 'Elliptical', 'cardio', 'cardio-floor', 'chain-standard', {
    brand: 'Life Fitness',
    note: 'Low impact. Good default when knees or hips are complaining.',
  }),
  station('arctrainer', 'Arc trainer', 'cardio', 'cardio-floor', 'chain-standard', {
    brand: 'Cybex',
    note: 'Stride feels between an elliptical and a stair climber.',
  }),
  station('uprightbike', 'Upright bike', 'cardio', 'cardio-floor', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('recumbentbike', 'Recumbent bike', 'cardio', 'cardio-floor', 'chain-standard', {
    brand: 'Life Fitness',
    note: 'Back support. The easiest option on a recovery day.',
  }),
  station('stairmill', 'Stair mill', 'cardio', 'cardio-floor', 'chain-standard', {
    note: 'Hardest of the cardio machines for a given speed setting. Pace yourself.',
  }),
  station('rower', 'Rowing machine', 'cardio', 'cardio-floor', 'chain-standard', {
    note: 'Full body. Drive with the legs first, then the back, then the arms.',
  }),
  station('cardiocinema', 'Cardio cinema', 'cardio', 'cardio-cinema', 'club-confirmed', {
    note: 'Darkened theatre room with treadmills and ellipticals. Good for long steady work.',
  }),
  station('poollaps', 'Pool — laps', 'water', 'pool', 'club-confirmed', {
    note: 'Indoor pool. Check the posted lane schedule; lanes get shared at peak times.',
  }),
  station('poolwalk', 'Pool — water walking', 'water', 'pool', 'club-confirmed', {
    note: 'Shallow end. Zero impact, and the water does the cooling for you.',
  }),
  station('basketball', 'Basketball court', 'court', 'courts', 'club-confirmed', {
    note: 'Open shooting counts as cardio. Check for scheduled play.',
  }),
  station('racquetball', 'Racquetball court', 'court', 'courts', 'club-confirmed', {
    note: 'Book at the front desk. Intense — treat it as an intervals day.',
  }),
];

/* ---------------------------------------------------------------- strength */

const STRENGTH: readonly Station[] = [
  // Legs
  station('legpressmachine', 'Leg press', 'plate-loaded', 'strength-machines', 'chain-standard', {
    brand: 'Hammer Strength',
    note: 'Angled sled. Load is plates per side, not total.',
  }),
  station('hacksquat', 'Hack squat', 'plate-loaded', 'strength-machines', 'chain-standard', {
    note: 'More quad-dominant than the leg press and harder on the knees. Start light.',
  }),
  station('legextension', 'Leg extension', 'selectorized', 'strength-machines', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('seatedlegcurl', 'Seated leg curl', 'selectorized', 'strength-machines', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('lyinglegcurl', 'Lying leg curl', 'selectorized', 'strength-machines', 'chain-standard'),
  station('smithmachine', 'Smith machine', 'rack', 'free-weights', 'chain-standard', {
    note: 'Fixed bar path. Useful when you want to push close to failure alone.',
  }),
  station('squatrack', 'Squat rack', 'rack', 'free-weights', 'chain-standard', {
    note: 'Set the safety pins before you load the bar.',
  }),
  station('olympicplatform', 'Olympic lifting platform', 'rack', 'free-weights', 'club-confirmed', {
    note: 'Confirmed at this club. Usually free outside peak evenings.',
  }),

  // Push
  station('chestpressmachine', 'Chest press machine', 'selectorized', 'strength-machines', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('isochestpress', 'Iso-lateral chest press', 'plate-loaded', 'strength-machines', 'chain-standard', {
    brand: 'Hammer Strength',
    note: 'Each arm loads independently, so a strong side cannot carry a weak one.',
  }),
  station(
    'inclinepressmachine',
    'Incline press machine',
    'plate-loaded',
    'strength-machines',
    'chain-standard',
    {
      brand: 'Hammer Strength',
    },
  ),
  station('pecdeck', 'Pec deck / chest fly', 'selectorized', 'strength-machines', 'chain-standard'),
  station(
    'shoulderpressmachine',
    'Shoulder press machine',
    'selectorized',
    'strength-machines',
    'chain-standard',
    {
      brand: 'Life Fitness',
    },
  ),
  station('dipstation', 'Dip / assisted dip station', 'bodyweight', 'strength-machines', 'chain-standard', {
    note: 'The assisted version counterweights you — a higher number means easier.',
  }),

  // Pull
  station('latpulldownmachine', 'Lat pulldown', 'cable', 'cable-area', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('seatedrowmachine', 'Seated cable row', 'cable', 'cable-area', 'chain-standard', {
    brand: 'Life Fitness',
  }),
  station('isorow', 'Iso-lateral row', 'plate-loaded', 'strength-machines', 'chain-standard', {
    brand: 'Hammer Strength',
    note: 'Chest-supported, so the low back stays out of it.',
  }),
  station('assistedpullup', 'Assisted pull-up', 'bodyweight', 'strength-machines', 'chain-standard', {
    note: 'Counterweighted. A higher setting takes more of your bodyweight off.',
  }),
  station('backextension', 'Back extension', 'bodyweight', 'strength-machines', 'chain-standard'),

  // Cables and free weights
  station('cablecrossover', 'Cable crossover', 'cable', 'cable-area', 'chain-standard', {
    note: 'Two adjustable stacks. Stands in for a lot of machines when they are busy.',
  }),
  station('functionaltrainer', 'Functional trainer', 'cable', 'cable-area', 'chain-standard'),
  station('dumbbells', 'Dumbbells', 'free-weight', 'free-weights', 'chain-standard', {
    note: 'The universal fallback. Rarely all taken at once.',
  }),
  station('barbell', 'Barbell', 'free-weight', 'free-weights', 'chain-standard'),
  station('kettlebells', 'Kettlebells', 'free-weight', 'turf', 'chain-standard'),
  station('flatbench', 'Flat bench', 'bench', 'free-weights', 'chain-standard'),
  station('adjustablebench', 'Adjustable bench', 'bench', 'free-weights', 'chain-standard', {
    note: 'About 30° for incline pressing — past 45° it becomes a shoulder press.',
  }),
];

/* ------------------------------------------------------- core and mobility */

const CORE_MOBILITY: readonly Station[] = [
  station('turfarea', 'Turf area', 'open-space', 'turf', 'club-confirmed', {
    note: 'Confirmed at this club. Space for carries, sleds, med balls and floor work.',
  }),
  station('stretcharea', 'Stretch area', 'open-space', 'stretch-area', 'chain-standard', {
    note: 'Mats and space to lie down. Where the core and mobility work belongs.',
  }),
  station('mat', 'Exercise mat', 'bodyweight', 'stretch-area', 'chain-standard'),
  station('abbench', 'Ab / decline bench', 'bench', 'strength-machines', 'chain-standard'),
  station('captainschair', 'Captain’s chair', 'bodyweight', 'strength-machines', 'chain-standard', {
    note: 'Vertical knee raise. Back flat against the pad.',
  }),
  station('abmachine', 'Ab crunch machine', 'selectorized', 'strength-machines', 'chain-standard'),
  station('stabilityball', 'Stability ball', 'bodyweight', 'stretch-area', 'chain-standard'),
  station('foamroller', 'Foam roller', 'bodyweight', 'stretch-area', 'chain-standard', {
    note: 'Slow passes. Spend longest where it is least comfortable.',
  }),
  station('medicineball', 'Medicine ball', 'free-weight', 'turf', 'chain-standard'),
  station('sauna', 'Sauna', 'open-space', 'locker-room', 'club-confirmed', {
    note: 'Confirmed at this club. Hydrate first; it does not replace the session.',
  }),
  station('spa', 'Spa / whirlpool', 'water', 'pool', 'club-confirmed'),
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

/** Stations confirmed in this club's published amenities. */
export function confirmedStations(): readonly Station[] {
  return ALL_STATIONS.filter((s) => s.confidence === 'club-confirmed');
}
