import type { Exercise, ExerciseCues, UserPlan, UserPlanDay, WeightUnit } from '@/types';
// Relative rather than `@/` on purpose — see the note in `src/spec/planSpec.ts`.
// This module is reachable from the build-time spec generator, which loads it
// outside Vite's alias resolution.
import { getBuiltinExercise } from '../data/exercises';
import { getStation } from '../data/equipment';
import { isDayKey } from '../data/plan';
import { isWeightUnit } from './units';

/**
 * The interchange format: what an LLM writes, and how it becomes a `UserPlan`.
 *
 * ## Why this file exists
 *
 * The app's premise is that you can ask any capable LLM for a training week
 * and load it here. That only works if there is a contract, and if the
 * contract is enforced by something that is not itself a language model. This
 * module is that enforcement: a total, never-throwing parse of arbitrary JSON
 * into a shape the rest of the app can rely on.
 *
 * ## Division of labour with the author
 *
 * The author decides what training happens: which movements, how they are
 * grouped, how long, how hard, in what order. They may define movements the
 * app has never heard of — that is the whole point, since the app cannot ship
 * a catalogue covering every gym and every body.
 *
 * The app keeps three things, and the format gives the author no way to
 * override them:
 *
 * - **Progression.** Loads after the first session come from logged history
 *   via `domain/progression.ts`. An author may suggest an *opening* weight for
 *   a movement with no history; it is used once and then never again.
 * - **Presentation.** Accent colours, plate weights, the display rep range.
 *   Derived on import so an imported day looks like a built-in one.
 * - **Identity.** Imported exercise ids are namespaced under `x:`. Logged sets
 *   reference exercise ids forever, so an imported plan that could define
 *   `legpress` would silently rewrite the meaning of every leg press in the
 *   user's history. It cannot.
 *
 * ## Validation happens elsewhere
 *
 * This file answers "are the fields the types they claim to be". Whether the
 * plan is *sensible* — seven distinct days, strength days that have exercises,
 * plausible durations — is `domain/planValidation.ts`, which runs afterwards
 * and can reject what this one accepted.
 */

/* --------------------------------------------------------------- contract */

/** Envelope marker. A file without this is not addressed to this app. */
export const PLAN_KIND = 'rackfile.plan';

/** Bumped only for a breaking change. Additive fields do not bump it. */
export const PLAN_FORMAT_VERSION = 1;

/**
 * Namespace for exercises defined by an imported plan.
 *
 * Load-bearing, not cosmetic. See the note on identity above.
 */
export const CUSTOM_ID_PREFIX = 'x:';

/**
 * Caps on anything the author controls the length of.
 *
 * A plan file arrives as text from a generative model, and the result is
 * persisted to the single localStorage key holding the user's entire training
 * history. There is no server to repair a browser whose storage has been
 * filled with one pathological note.
 */
const LIMITS = {
  name: 80,
  summary: 300,
  cue: 400,
  note: 1200,
  outlineStep: 200,
  outlineSteps: 12,
  equipment: 200,
  exercisesPerPlan: 60,
  exercisesPerDay: 20,
  tips: 6,
  muscles: 8,
  stationsPerDay: 12,
} as const;

/** Whether an id belongs to a plan-defined movement rather than the catalogue. */
export function isCustomExerciseId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/* ----------------------------------------------------------------- guards */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trim, collapse inner whitespace, and cap. Returns `''` for non-strings. */
function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Trim and cap while keeping paragraph breaks, for prose the user reads.
 *
 * Distinct from `str` because collapsing every newline in a session note turns
 * a readable set of instructions into a wall.
 */
function prose(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function strings(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => str(item, cap))
    .filter((item) => item.length > 0)
    .slice(0, max);
}

/* ------------------------------------------------------ exercise definition */

/**
 * Turn one authored movement into an `Exercise`.
 *
 * Returns `null` only when the movement is unusable — no name, or no id to
 * reference it by. Everything else has a defensible default, because rejecting
 * a whole week over a missing rest interval would serve nobody.
 */
export function parseCustomExercise(raw: unknown): Exercise | null {
  if (!isRecord(raw)) return null;

  // Already-namespaced ids arrive when re-parsing a plan out of storage. Strip
  // the prefix so it is applied exactly once rather than accumulating.
  const rawId = str(raw['id'], 60).toLowerCase().replace(CUSTOM_ID_PREFIX, '');
  const name = str(raw['name'], LIMITS.name);
  if (!name) return null;

  /*
   * Fall back to a slug of the name when the author omitted an id. Common
   * enough in practice — models name things well and forget keys — and the
   * alternative is discarding a perfectly good movement.
   */
  const slug = (rawId || name.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!slug) return null;

  const repMetric = raw['repMetric'] === 'seconds' ? 'seconds' : 'reps';
  const loaded = raw['loaded'] === true;

  // Seconds-based holds get wider, longer defaults than rep-based lifts.
  const defaultMin = repMetric === 'seconds' ? 20 : 8;
  const defaultMax = repMetric === 'seconds' ? 45 : 12;

  const repMin = Math.round(num(raw['repMin'], 1, 500, defaultMin));
  const repMax = Math.round(num(raw['repMax'], repMin, 500, Math.max(repMin, defaultMax)));

  const cues = parseCues(raw['cues']);
  const stationIds = resolveStationIds(raw['stationId'], raw['stationIds']);
  const openingWeight = parseOpeningWeight(raw['openingWeight']);
  const equipment = str(raw['equipment'], LIMITS.equipment);
  const alternative = str(raw['alternative'], LIMITS.name);
  const tips = strings(raw['tips'], LIMITS.tips, LIMITS.cue);
  const muscles = strings(raw['muscles'], LIMITS.muscles, 40);

  return {
    id: `${CUSTOM_ID_PREFIX}${slug}`,
    name,
    source: 'plan',
    summary: str(raw['summary'], LIMITS.summary) || `${name}.`,
    sets: Math.round(num(raw['sets'], 1, 12, 3)),
    // Display copy the app owns, derived rather than accepted, so an author
    // cannot put "8-12 (go heavy!)" where a rep range belongs.
    repRange: repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`,
    repMin,
    repMax,
    defaultReps: Math.round((repMin + repMax) / 2),
    repMetric,
    loaded,
    restSeconds: Math.round(num(raw['restSeconds'], 0, 600, repMetric === 'seconds' ? 45 : 90)),
    cues,
    ...(equipment ? { equipment } : {}),
    ...(alternative ? { alternative } : {}),
    ...(tips.length > 0 ? { tips } : {}),
    ...(muscles.length > 0 ? { muscles } : {}),
    ...(stationIds.length > 0 ? { stations: stationIds.map((stationId) => ({ stationId })) } : {}),
    // Only meaningful on a loaded movement — an opening weight for a plank is
    // a category error, and silently dropping it beats rendering it.
    ...(loaded && openingWeight ? { openingWeight } : {}),
  };
}

/**
 * The three coaching cues.
 *
 * Filled with honest placeholders rather than left blank. An exercise card
 * with an empty "Avoid" line looks like a rendering bug; one that says the
 * plan did not supply it tells the truth about where the gap is.
 */
function parseCues(raw: unknown): ExerciseCues {
  const record = isRecord(raw) ? raw : {};
  return {
    setup: str(record['setup'], LIMITS.cue) || 'The plan did not describe the setup for this movement.',
    execute: str(record['execute'], LIMITS.cue) || 'The plan did not describe how to perform this movement.',
    avoid:
      str(record['avoid'], LIMITS.cue) ||
      'The plan did not say what to avoid. Start light and stop if anything hurts.',
  };
}

/**
 * Resolve the author's equipment hints against the built-in vocabulary.
 *
 * Unknown ids are dropped rather than rejected. A station id is a bonus that
 * lights up the swap sheet when it happens to match; the authoritative
 * description of what you need is the free-text `equipment` field, which is
 * why an unrecognised hint costs the user nothing.
 */
function resolveStationIds(single: unknown, list: unknown): string[] {
  const candidates = [
    ...(typeof single === 'string' ? [single] : []),
    ...(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []),
  ];

  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const id = candidate.trim().toLowerCase();
    if (!id || seen.has(id) || !getStation(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved.slice(0, LIMITS.stationsPerDay);
}

function parseOpeningWeight(raw: unknown): Exercise['openingWeight'] | null {
  if (!isRecord(raw)) return null;

  const value = num(raw['value'], 0, 2000, -1);
  if (value < 0) return null;

  const unit: WeightUnit = isWeightUnit(raw['unit']) ? raw['unit'] : 'lb';
  return { value, unit };
}

/* ------------------------------------------------------------------- days */

function parseDay(raw: unknown, knownExerciseIds: ReadonlySet<string>): UserPlanDay | null {
  if (!isRecord(raw)) return null;

  const dayKey = typeof raw['dayKey'] === 'string' ? raw['dayKey'].trim().toLowerCase() : '';
  if (!isDayKey(dayKey)) return null;

  const type = parseSessionType(raw['type']);
  const label = str(raw['label'], LIMITS.name);
  const minutes = raw['minutes'];
  const format = raw['exerciseFormat'];
  const rounds = str(raw['rounds'], 20);
  const modality = str(raw['modality'], LIMITS.equipment);

  const exerciseIds = resolveExerciseIds(raw['exerciseIds'], knownExerciseIds);
  const modalityStations = resolveStationIds(undefined, raw['modalityStations']);
  const outline = strings(raw['outline'], LIMITS.outlineSteps, LIMITS.outlineStep);

  return {
    dayKey,
    label,
    type,
    sub: str(raw['sub'], LIMITS.summary),
    note: prose(raw['note'], LIMITS.note),
    outline,
    aerobic: raw['aerobic'] === true,
    ...(typeof minutes === 'number' && Number.isFinite(minutes)
      ? { minutes: Math.round(num(minutes, 0, 600, 0)) }
      : {}),
    ...(modalityStations.length > 0 ? { modalityStations } : {}),
    ...(modality ? { modality } : {}),
    ...(exerciseIds.length > 0 ? { exerciseIds } : {}),
    ...(format === 'circuit' || format === 'sets' ? { exerciseFormat: format } : {}),
    ...(rounds ? { rounds } : {}),
  };
}

const SESSION_TYPES = ['strength', 'duration', 'intervals', 'mixed', 'rest'] as const;

function parseSessionType(raw: unknown): UserPlanDay['type'] {
  const found = SESSION_TYPES.find((type) => type === raw);
  return found ?? 'rest';
}

/**
 * Map the author's exercise references onto ids that actually resolve.
 *
 * An id may name a built-in movement or one this plan defined. Anything else
 * is dropped here and reported by the validator, which can see the whole plan
 * and say which day lost what.
 */
function resolveExerciseIds(raw: unknown, knownCustomIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(raw)) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim().toLowerCase();
    if (!id) continue;

    // Try the plan's own vocabulary first, then the built-in catalogue. An
    // author referencing "legpress" almost certainly means the catalogue's.
    const namespaced = isCustomExerciseId(id) ? id : `${CUSTOM_ID_PREFIX}${id.replace(/[^a-z0-9]+/g, '-')}`;
    const match = knownCustomIds.has(namespaced)
      ? namespaced
      : getBuiltinExercise(id)
        ? id
        : knownCustomIds.has(id)
          ? id
          : null;

    if (!match || seen.has(match)) continue;
    seen.add(match);
    resolved.push(match);
  }

  return resolved.slice(0, LIMITS.exercisesPerDay);
}

/* ----------------------------------------------------------------- public */

export interface ParsedPlan {
  readonly plan: UserPlan | null;
  /**
   * Why parsing failed, when it did. Written for the person who pasted the
   * file, not for a log — they are the one who has to fix it.
   */
  readonly error: string | null;
}

/**
 * Parse arbitrary untrusted input into a `UserPlan`.
 *
 * Accepts an already-parsed object or a raw string. Never throws.
 */
export function parsePortablePlan(input: unknown): ParsedPlan {
  const raw = typeof input === 'string' ? decode(input) : input;

  if (raw === null) {
    return { plan: null, error: 'That does not look like JSON. Paste the whole plan file, braces included.' };
  }
  if (!isRecord(raw)) {
    return { plan: null, error: 'A plan file has to be a JSON object.' };
  }

  const kind = typeof raw['kind'] === 'string' ? raw['kind'] : '';
  if (kind && kind !== PLAN_KIND) {
    return { plan: null, error: `That file says it is "${kind}", which is not a plan for this app.` };
  }

  const version = raw['formatVersion'];
  if (typeof version === 'number' && version > PLAN_FORMAT_VERSION) {
    return {
      plan: null,
      error: `That plan uses format version ${version}, but this app understands version ${PLAN_FORMAT_VERSION}. Update the app.`,
    };
  }

  if (!Array.isArray(raw['days'])) {
    return { plan: null, error: 'The plan has no "days" array.' };
  }

  const exercises = Array.isArray(raw['exercises'])
    ? raw['exercises']
        .slice(0, LIMITS.exercisesPerPlan)
        .map(parseCustomExercise)
        .filter((exercise): exercise is Exercise => exercise !== null)
    : [];

  // Last definition wins on a duplicate id, and the map is what the days
  // resolve against, so a plan defining the same movement twice is merely
  // redundant rather than broken.
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const days = raw['days']
    .map((day) => parseDay(day, new Set(byId.keys())))
    .filter((day): day is UserPlanDay => day !== null);

  if (days.length === 0) {
    return { plan: null, error: 'None of the days in that plan could be read.' };
  }

  const model = str(raw['author'] ?? raw['model'], LIMITS.name) || 'imported';

  return {
    plan: {
      id: `plan-${Date.now().toString(36)}`,
      summary: prose(raw['summary'], LIMITS.note),
      days,
      ...(byId.size > 0 ? { exercises: [...byId.values()] } : {}),
      generatedAt: Date.now(),
      model,
    },
    error: null,
  };
}

/**
 * Pull JSON out of whatever the user actually pasted.
 *
 * Chat interfaces wrap code in fences, and people paste the surrounding
 * sentence along with it. Refusing that paste would be technically correct and
 * practically useless, so this digs out the object instead.
 */
function decode(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];

  // ```json … ``` — take the largest fenced block, which is the plan rather
  // than any short example the model included in its explanation.
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  candidates.push(...fences);

  // Bare object embedded in prose.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}
