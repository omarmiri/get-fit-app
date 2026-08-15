import type {
  AppState,
  Effort,
  GeneratedPlan,
  FitnessLevel,
  LoggedSet,
  Preferences,
  Session,
  SetEffort,
  UserProfile,
  WeightUnit,
} from '@/types';
import { isDayKey } from '@/data/plan';
import { isValidIsoDate } from '@/domain/dates';
import { clampMinutes, clampNumber, clampReps, clampWeight } from '@/domain/limits';
import { isWeightUnit } from '@/domain/units';

/**
 * Persisted-state parsing, validation and migration.
 *
 * There is no server, so a user's entire training history is whatever sits in
 * their browser. Two consequences shape this file:
 *
 * - Parsing is total. Anything unreadable is dropped rather than thrown on, so
 *   one corrupt session can never make the app refuse to start.
 * - Migrations are forward-only and additive. Bump `CURRENT_SCHEMA_VERSION` and
 *   add a step whenever a persisted shape changes.
 */

export const CURRENT_SCHEMA_VERSION = 7;

/**
 * Longest free-text gym description kept.
 *
 * Generous for a paragraph about a gym, and a hard stop on a pathological
 * paste. There is no server to repair a browser whose only storage key has
 * become a novel.
 */
const MAX_GYM_LENGTH = 2000;

/** Storage key for the current schema. */
export const STORAGE_KEY = 'rackfile:state';

/** Storage key written by v0.1. Read once, migrated, then left in place. */
export const LEGACY_STORAGE_KEY = 'rackfile:v1';

/**
 * Exercise ids that were renamed, mapped old to new.
 *
 * `hamstring` was the id for an exercise displayed as "Glute bridge" — the id
 * described the alternative rather than the movement. Renaming it without this
 * map would have silently orphaned every logged set.
 */
const EXERCISE_ID_ALIASES: Readonly<Record<string, string>> = {
  hamstring: 'glutebridge',
};

const EFFORTS: readonly Effort[] = ['Easy', 'Moderate', 'Hard'];
const SET_EFFORTS: readonly SetEffort[] = ['easy', 'right', 'hard'];
const LEVELS: readonly FitnessLevel[] = ['new', 'returning', 'experienced'];

export const DEFAULT_PREFERENCES: Preferences = {
  unit: 'lb',
  restVibrate: true,
};

export function defaultState(): AppState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sessions: [],
    active: null,
    prefs: DEFAULT_PREFERENCES,
    plan: null,
  };
}

/** Outcome of parsing untrusted stored or imported data. */
export interface ParseResult {
  readonly state: AppState;
  /** Records that failed validation and were dropped. Surfaced on import. */
  readonly dropped: number;
  /** True when the input was recognised as app data at all. */
  readonly recognised: boolean;
}

/* ------------------------------------------------------------------ guards */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function canonicalExerciseId(id: string): string {
  return EXERCISE_ID_ALIASES[id] ?? id;
}

/* ------------------------------------------------------------- record parse */

/**
 * Parse one logged set from either schema version.
 *
 * v1 used `{ ex, w, r, ts }` with weights implicitly in pounds; v2 uses
 * explicit field names and records the unit alongside the value.
 */
function parseSet(raw: unknown): LoggedSet | null {
  if (!isRecord(raw)) return null;

  const rawId = raw['exerciseId'] ?? raw['ex'];
  if (typeof rawId !== 'string' || rawId.length === 0) return null;

  const unit: WeightUnit = isWeightUnit(raw['unit']) ? raw['unit'] : 'lb';
  const weight = clampWeight(raw['weight'] ?? raw['w'] ?? 0);
  const reps = clampReps(raw['reps'] ?? raw['r'] ?? 0);

  const rawStation = raw['stationId'];
  const stationId = typeof rawStation === 'string' && rawStation.length > 0 ? rawStation : undefined;

  const effort = SET_EFFORTS.find((value) => value === raw['effort']);

  return {
    exerciseId: canonicalExerciseId(rawId),
    weight,
    unit,
    reps,
    loggedAt: finiteOr(raw['loggedAt'] ?? raw['ts'], 0),
    // Absent on everything logged before stations existed. Left undefined
    // rather than back-filled — guessing where a past set happened would put
    // invented data into the history.
    ...(stationId === undefined ? {} : { stationId }),
    ...(effort === undefined ? {} : { effort }),
  };
}

let fallbackIdCounter = 0;

function makeSessionId(): string {
  fallbackIdCounter += 1;
  return `s${Date.now().toString(36)}${fallbackIdCounter.toString(36)}`;
}

/** Parse one session. Returns `null` when it lacks the fields that identify it. */
function parseSession(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  if (!isValidIsoDate(raw['date'])) return null;
  if (!isDayKey(raw['dayKey'])) return null;

  const rawSets = Array.isArray(raw['sets']) ? raw['sets'] : [];
  const sets = rawSets.map(parseSet).filter((set): set is LoggedSet => set !== null);

  const rawMinutes = raw['minutes'];
  const minutes = rawMinutes === null || rawMinutes === undefined ? null : clampMinutes(rawMinutes);

  const rawModality = raw['modality'];
  const modality = typeof rawModality === 'string' && rawModality.length > 0 ? rawModality : null;

  // v1 called this `rpe`, which implied a numeric scale it never used.
  const rawEffort = raw['effort'] ?? raw['rpe'];
  const effort = EFFORTS.find((value) => value === rawEffort) ?? null;

  const rawId = raw['id'];
  const startedAt = finiteOr(raw['startedAt'] ?? raw['started'], 0);
  const rawFinishedAt = raw['finishedAt'];
  const rawDuration = raw['durationMinutes'];

  const session: Session = {
    id: typeof rawId === 'string' && rawId.length > 0 ? rawId : makeSessionId(),
    date: raw['date'],
    dayKey: raw['dayKey'],
    sets,
    minutes,
    modality,
    effort,
    startedAt,
    ...(typeof rawFinishedAt === 'number' && Number.isFinite(rawFinishedAt)
      ? { finishedAt: rawFinishedAt }
      : {}),
    // Absent on every session logged before the session clock existed. Left
    // undefined rather than derived from `startedAt` — those timestamps mark
    // the first logged set, not the start of the workout, so a back-filled
    // duration would understate every one of them.
    ...(typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
      ? { durationMinutes: clampMinutes(rawDuration) }
      : {}),
    // Absent on sessions logged before plans could change. History falls back
    // to a lookup for those.
    ...(typeof raw['planLabel'] === 'string' && raw['planLabel'].length > 0
      ? { planLabel: raw['planLabel'] }
      : {}),
  };
  return session;
}

/**
 * Parse the onboarding profile.
 *
 * Returns `undefined` for anything incomplete rather than filling in defaults —
 * a fabricated bodyweight would silently produce wrong starting weights, and
 * the app is perfectly usable with no profile at all.
 */
function parseProfile(raw: unknown): UserProfile | undefined {
  if (!isRecord(raw)) return undefined;

  const age = clampNumber(raw['age'], { min: 10, max: 100 }, 0);
  const bodyweight = clampNumber(raw['bodyweight'], { min: 0, max: 1000 }, 0);
  if (age <= 0 || bodyweight <= 0) return undefined;

  const level = LEVELS.find((value) => value === raw['level']);
  if (!level) return undefined;

  const rawDate = raw['recordedOn'];

  return {
    age: Math.round(age),
    bodyweight,
    bodyweightUnit: isWeightUnit(raw['bodyweightUnit']) ? raw['bodyweightUnit'] : 'lb',
    level,
    recordedOn: isValidIsoDate(rawDate) ? rawDate : '1970-01-01',
  };
}

function parsePreferences(raw: unknown): Preferences {
  if (!isRecord(raw)) return DEFAULT_PREFERENCES;

  // v1 stored the trend selection under `trend`.
  const rawTrend = raw['trendExerciseId'] ?? raw['trend'];
  const trendExerciseId = typeof rawTrend === 'string' && rawTrend.length > 0 ? rawTrend : undefined;

  const rawMissing = raw['missingStations'];
  const missingStations = Array.isArray(rawMissing)
    ? rawMissing.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  const profile = parseProfile(raw['profile']);

  const rawConditions = raw['conditions'];
  const conditions = Array.isArray(rawConditions)
    ? rawConditions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];

  const rawGym = raw['gym'];
  const gym = typeof rawGym === 'string' ? rawGym.trim().slice(0, MAX_GYM_LENGTH) : '';

  const rawPreferred = raw['preferredStations'];
  const preferredStations: Record<string, string> = {};
  if (isRecord(rawPreferred)) {
    for (const [exerciseId, stationId] of Object.entries(rawPreferred)) {
      if (typeof stationId === 'string' && stationId.length > 0) {
        preferredStations[canonicalExerciseId(exerciseId)] = stationId;
      }
    }
  }

  return {
    unit: isWeightUnit(raw['unit']) ? raw['unit'] : DEFAULT_PREFERENCES.unit,
    restVibrate:
      typeof raw['restVibrate'] === 'boolean' ? raw['restVibrate'] : DEFAULT_PREFERENCES.restVibrate,
    ...(trendExerciseId === undefined ? {} : { trendExerciseId: canonicalExerciseId(trendExerciseId) }),
    ...(missingStations.length === 0 ? {} : { missingStations }),
    ...(Object.keys(preferredStations).length === 0 ? {} : { preferredStations }),
    ...(profile === undefined ? {} : { profile }),
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(gym.length === 0 ? {} : { gym }),
    ...(raw['onboarded'] === true || profile !== undefined ? { onboarded: true } : {}),
  };
}

/**
 * Parse a stored generated plan.
 *
 * Shape only. Whether the plan is sensible is decided by `validatePlan`, which
 * runs before it is ever adopted; anything already stored has been through it.
 */
function parsePlan(raw: unknown): GeneratedPlan | null {
  if (!isRecord(raw) || !Array.isArray(raw['days'])) return null;

  const days = raw['days']
    .filter(isRecord)
    .filter((day) => isDayKey(day['dayKey']))
    .map((day) => day as unknown as GeneratedPlan['days'][number]);

  if (days.length === 0) return null;

  return {
    id: typeof raw['id'] === 'string' ? raw['id'] : `plan-${Date.now().toString(36)}`,
    summary: typeof raw['summary'] === 'string' ? raw['summary'] : '',
    days,
    generatedAt: finiteOr(raw['generatedAt'], 0),
    model: typeof raw['model'] === 'string' ? raw['model'] : 'unknown',
  };
}

/* ------------------------------------------------------------------ public */

/**
 * Parse untrusted data — from storage or from an imported backup file — into a
 * valid `AppState`.
 *
 * Never throws. Unreadable records are counted in `dropped` so the caller can
 * tell the user something was lost instead of failing silently.
 */
export function parseState(raw: unknown): ParseResult {
  if (!isRecord(raw) || !Array.isArray(raw['sessions'])) {
    return { state: defaultState(), dropped: 0, recognised: false };
  }

  const rawSessions = raw['sessions'];
  const sessions = rawSessions.map(parseSession).filter((s): s is Session => s !== null);
  const dropped = rawSessions.length - sessions.length;

  // Oldest first, with a stable tie-break so equal dates keep a fixed order.
  const ordered = [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );

  const active = parseSession(raw['active']);

  return {
    state: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sessions: ordered,
      active,
      prefs: parsePreferences(raw['prefs']),
      plan: parsePlan(raw['plan']),
    },
    dropped,
    recognised: true,
  };
}

/** Parse a JSON string. Returns an unrecognised result for malformed JSON. */
export function parseStateJson(json: string): ParseResult {
  try {
    return parseState(JSON.parse(json));
  } catch {
    return { state: defaultState(), dropped: 0, recognised: false };
  }
}

/** Serialize state for storage or export. */
export function serializeState(state: AppState, pretty = false): string {
  return JSON.stringify(state, null, pretty ? 2 : 0);
}
