/**
 * What the user can train with, asked as questions rather than a blank box.
 *
 * ## Why this is structured input but unstructured output
 *
 * What gets *sent* to a language model stays prose. That decision has not
 * changed and the reasoning still holds: the consumer reads English perfectly
 * well, and a schema broad enough for every gym on earth is a schema nobody
 * can maintain.
 *
 * What changed is how the prose gets written. It used to be a free-text box,
 * which meant it stayed empty — so the prompt told the model to assume a
 * commercial gym and guess. An empty box is not a neutral default; it is a
 * question the user did not know they were being asked.
 *
 * So the answers are collected as choices and the sentences are generated. The
 * text stays editable afterwards, because no fixed set of questions covers "the
 * squat racks are always taken after 5pm", which is exactly the kind of thing
 * that makes a plan usable.
 */

export type VenueKind = 'chain' | 'rec' | 'apartment' | 'home' | 'outdoor';

export interface VenueOption {
  readonly id: VenueKind;
  readonly label: string;
  /** Examples, so someone recognises their own situation rather than guessing. */
  readonly hint: string;
  /** Equipment ticked by default when this venue is chosen. */
  readonly implies: readonly EquipmentId[];
}

export type EquipmentId =
  | 'dumbbells'
  | 'barbell'
  | 'machines'
  | 'cables'
  | 'kettlebells'
  | 'bench'
  | 'pullupbar'
  | 'bands'
  | 'cardio'
  | 'rower'
  | 'pool'
  | 'turf';

export interface EquipmentOption {
  readonly id: EquipmentId;
  readonly label: string;
}

/**
 * Venue presets.
 *
 * `implies` is a starting tick, never a claim. A big chain usually has cables
 * and a pool; yours might not, which is why every box stays editable. The
 * point is to save typing, not to tell the user what their gym contains.
 */
export const VENUES: readonly VenueOption[] = [
  {
    id: 'chain',
    label: 'Large gym chain',
    hint: 'LA Fitness, Planet Fitness, 24 Hour Fitness, Gold’s',
    implies: ['dumbbells', 'barbell', 'machines', 'cables', 'bench', 'cardio'],
  },
  {
    id: 'rec',
    label: 'Rec center or YMCA',
    hint: 'Community center, university gym, municipal leisure centre',
    implies: ['dumbbells', 'barbell', 'machines', 'bench', 'cardio', 'pool'],
  },
  {
    id: 'apartment',
    label: 'Apartment or condo gym',
    hint: 'Building gym — usually a few machines and a dumbbell rack',
    implies: ['dumbbells', 'bench', 'cardio'],
  },
  {
    id: 'home',
    label: 'Home or garage gym',
    hint: 'Whatever you own — tick it below',
    implies: ['dumbbells'],
  },
  {
    id: 'outdoor',
    label: 'No gym',
    hint: 'Bodyweight, outdoors, whatever is to hand',
    implies: [],
  },
];

export const EQUIPMENT: readonly EquipmentOption[] = [
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'barbell', label: 'Barbell and rack' },
  { id: 'machines', label: 'Weight machines' },
  { id: 'cables', label: 'Cable machines' },
  { id: 'kettlebells', label: 'Kettlebells' },
  { id: 'bench', label: 'Adjustable bench' },
  { id: 'pullupbar', label: 'Pull-up bar' },
  { id: 'bands', label: 'Resistance bands' },
  { id: 'cardio', label: 'Cardio machines' },
  { id: 'rower', label: 'Rowing machine' },
  { id: 'pool', label: 'Swimming pool' },
  { id: 'turf', label: 'Turf or sled area' },
];

/** The answers, all optional — every question can go unanswered. */
export interface GymProfile {
  readonly venue?: VenueKind;
  readonly equipment?: readonly EquipmentId[];
  /** Whether they can run or walk from their door. */
  readonly outdoors?: boolean;
  /** Sessions per week they can realistically make. */
  readonly daysPerWeek?: number;
  /** Minutes they have for a session. */
  readonly sessionMinutes?: number;
}

const VENUE_SENTENCE: Readonly<Record<VenueKind, string>> = {
  chain: 'I train at a large commercial gym chain.',
  rec: 'I train at a rec center / YMCA-style gym.',
  apartment: 'I train in my apartment or condo building’s gym.',
  home: 'I train at home with my own equipment.',
  outdoor: 'I have no gym — bodyweight and outdoors only.',
};

/**
 * Turn the answers into the paragraph the model actually reads.
 *
 * Written as first-person sentences because it is dropped into a prompt the
 * user is nominally speaking. Returns `''` when nothing has been answered, so
 * an untouched profile is indistinguishable from an absent one and the prompt
 * can fall back to telling the model to assume.
 */
export function describeGym(profile: GymProfile): string {
  const parts: string[] = [];

  if (profile.venue) parts.push(VENUE_SENTENCE[profile.venue]);

  const equipment = (profile.equipment ?? [])
    .map((id) => EQUIPMENT.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  if (equipment.length > 0) {
    parts.push(`Available: ${equipment.join(', ').toLowerCase()}.`);
  } else if (profile.venue) {
    /*
     * A venue with nothing ticked is a real answer, not an oversight — it is
     * what "no gym" means. Saying so beats leaving the model to infer it from
     * an absence.
     */
    parts.push('No equipment beyond my own bodyweight.');
  }

  if (profile.outdoors === true) parts.push('I can run or walk outdoors from home.');
  if (profile.outdoors === false) parts.push('I cannot train outdoors — everything has to be indoors.');

  if (profile.daysPerWeek) {
    parts.push(`I can train ${profile.daysPerWeek} ${profile.daysPerWeek === 1 ? 'day' : 'days'} a week.`);
  }
  if (profile.sessionMinutes) {
    parts.push(`I have about ${profile.sessionMinutes} minutes per session.`);
  }

  return parts.join(' ');
}

/** Whether anything has been answered at all. */
export function hasAnswers(profile: GymProfile): boolean {
  return (
    profile.venue !== undefined ||
    (profile.equipment?.length ?? 0) > 0 ||
    profile.outdoors !== undefined ||
    profile.daysPerWeek !== undefined ||
    profile.sessionMinutes !== undefined
  );
}
