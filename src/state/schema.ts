import type { AppState, Effort, LoggedSet, Preferences, Session, WeightUnit } from '@/types';
import { isDayKey } from '@/data/plan';
import { isValidIsoDate } from '@/domain/dates';
import { clampMinutes, clampReps, clampWeight } from '@/domain/limits';
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

export const CURRENT_SCHEMA_VERSION = 2;

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

  return {
    exerciseId: canonicalExerciseId(rawId),
    weight,
    unit,
    reps,
    loggedAt: finiteOr(raw['loggedAt'] ?? raw['ts'], 0),
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
  };
  return session;
}

function parsePreferences(raw: unknown): Preferences {
  if (!isRecord(raw)) return DEFAULT_PREFERENCES;

  // v1 stored the trend selection under `trend`.
  const rawTrend = raw['trendExerciseId'] ?? raw['trend'];
  const trendExerciseId = typeof rawTrend === 'string' && rawTrend.length > 0 ? rawTrend : undefined;

  return {
    unit: isWeightUnit(raw['unit']) ? raw['unit'] : DEFAULT_PREFERENCES.unit,
    restVibrate:
      typeof raw['restVibrate'] === 'boolean' ? raw['restVibrate'] : DEFAULT_PREFERENCES.restVibrate,
    ...(trendExerciseId === undefined ? {} : { trendExerciseId: canonicalExerciseId(trendExerciseId) }),
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
