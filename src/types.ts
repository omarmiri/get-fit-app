/**
 * Domain model for Rack & File.
 *
 * Everything the app persists or renders is described here. Two rules keep this
 * file useful as the app grows:
 *
 * 1. Persisted shapes (`AppState` and everything it reaches) are versioned. If
 *    you change one, add a migration in `state/migrations.ts` and bump
 *    `CURRENT_SCHEMA_VERSION`. Users' logs live in their browser and there is no
 *    server to fix them up.
 * 2. Content shapes (`Exercise`, `PlanDay`) are open to additive optional fields
 *    — media, tips, muscle groups. Adding one must never require touching the
 *    logging or history code.
 */

/* -------------------------------------------------------------- primitives */

/** Weight unit. Sets record the unit they were logged in, so no lossy rewrite. */
export type WeightUnit = 'lb' | 'kg';

/**
 * What the second stepper counts. `reps` are countable repetitions; `seconds`
 * are hold or carry time. The distinction matters: a one-rep-max estimate is
 * meaningless for a 30-second plank, so trend charts filter on this.
 */
export type RepMetric = 'reps' | 'seconds';

/** Lowercase three-letter day keys, indexed by `Date#getDay()`. */
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/** A calendar date as `YYYY-MM-DD` in the device's local timezone. */
export type IsoDate = string;

/** How a session is performed, which decides what the Today view renders. */
export type SessionType = 'strength' | 'duration' | 'intervals' | 'mixed';

/** Subjective exertion, kept coarse on purpose — a 1-10 RPE scale invites false precision. */
export type Effort = 'Easy' | 'Moderate' | 'Hard';

/* -------------------------------------------------------------- equipment */

/** Where in the club a station lives, so the app can say where to walk. */
export type Zone =
  | 'cardio-floor'
  | 'cardio-cinema'
  | 'strength-machines'
  | 'free-weights'
  | 'cable-area'
  | 'turf'
  | 'stretch-area'
  | 'pool'
  | 'courts'
  | 'studio'
  | 'locker-room';

/** How a station is loaded, which decides whether loads carry across a swap. */
export type StationKind =
  | 'cardio'
  | 'selectorized'
  | 'plate-loaded'
  | 'free-weight'
  | 'cable'
  | 'bodyweight'
  | 'bench'
  | 'rack'
  | 'open-space'
  | 'water'
  | 'court';

/**
 * How sure the app is that a station exists at this specific club.
 *
 * This distinction is the honest core of the equipment data. LA Fitness
 * publishes club amenities but not machine inventories, and no third party
 * does either. Anything marked `chain-standard` is an informed guess from the
 * chain's usual lineup and must be presented as such — the user confirms or
 * corrects it on their first visit.
 */
export type StationConfidence = 'club-confirmed' | 'chain-standard';

/** A piece of equipment or a space in the club. */
export interface Station {
  readonly id: string;
  readonly name: string;
  readonly kind: StationKind;
  readonly zone: Zone;
  readonly confidence: StationConfidence;
  /** Manufacturer, where the chain's standard lineup makes it predictable. */
  readonly brand?: string;
  /** Short note on finding or setting it up. */
  readonly note?: string;
  /** Roadmap: photo or clip of the station itself. */
  readonly media?: ExerciseMedia;
  /** Roadmap: step-by-step setup instructions for this machine. */
  readonly instructions?: readonly string[];
}

/**
 * One way to perform an exercise, tied to a specific station.
 *
 * The first option in an exercise's list is the default. The rest are what the
 * app offers when that station is taken.
 */
export interface StationOption {
  readonly stationId: string;
  /** Why this substitution works, shown in the swap sheet. */
  readonly note?: string;
  /**
   * Rough load conversion from the primary station, as a multiplier.
   *
   * A machine chest press and a pair of dumbbells do not move the same number
   * for the same effort. `1` means loads carry across unchanged; `0.4` means
   * start around 40% of the primary station's load. Deliberately approximate —
   * it seeds the stepper, it does not claim to be equivalent.
   */
  readonly loadFactor?: number;
  /** True when the load is per hand rather than total, e.g. dumbbells. */
  readonly perHand?: boolean;
}

/* ----------------------------------------------------------------- content */

/**
 * Illustrative media for an exercise. All optional and all additive — the
 * exercise card renders whatever is present and stays silent otherwise, so
 * content can be filled in one exercise at a time.
 */
export interface ExerciseMedia {
  /** Still image, resolved through the bundler or served from `/media`. */
  readonly image?: string;
  /** Short demonstration clip. Muted and looping when rendered. */
  readonly video?: string;
  /** Poster frame shown before `video` loads. */
  readonly poster?: string;
  /** Required whenever `image` is set — this is the accessible description. */
  readonly alt?: string;
  /** Attribution line, if the asset needs one. */
  readonly credit?: string;
}

/** The three coaching cues shown under every exercise. */
export interface ExerciseCues {
  /** How to get into position before the first rep. */
  readonly setup: string;
  /** What to do during the rep. */
  readonly execute: string;
  /** The single most common way this movement goes wrong. */
  readonly avoid: string;
}

/**
 * One movement in the plan.
 *
 * `id` is a stable persistence key: logged sets reference it forever, so
 * renaming an exercise is safe but changing its id orphans history.
 */
export interface Exercise {
  readonly id: string;
  readonly name: string;
  /** Equipment-free or lighter substitute, shown as "or ..." on the card. */
  readonly alternative?: string;
  /** Target working sets. Drives the set dots and the auto-advance. */
  readonly sets: number;
  /** Human-readable target, e.g. `8–12` or `20–30`. Display only. */
  readonly repRange: string;
  /** Seed value for the reps stepper when there is no history. */
  readonly defaultReps: number;
  readonly repMetric: RepMetric;
  /** Whether this movement is normally loaded. Bodyweight holds are not. */
  readonly loaded: boolean;
  readonly restSeconds: number;
  readonly cues: ExerciseCues;
  /** Roadmap: freeform coaching notes, rendered as a list under the cues. */
  readonly tips?: readonly string[];
  /** Roadmap: primary muscles worked, for filtering and future substitutions. */
  readonly muscles?: readonly string[];
  /**
   * Stations this movement can be performed on, best first.
   *
   * The head of the list is the default. The tail is what the app offers when
   * the default is occupied — the whole point of the swap sheet.
   */
  readonly stations?: readonly StationOption[];
  /** Roadmap: illustration or demo clip. */
  readonly media?: ExerciseMedia;
}

/** One day of the seven-day rotation. */
export interface PlanDay {
  readonly key: DayKey;
  readonly label: string;
  readonly type: SessionType;
  /** Olympic plate colour standing in for the day's relative load. */
  readonly color: string;
  /** The plate weight that colour denotes, e.g. `25 kg`. Decorative. */
  readonly load: string;
  /** One-line description under the title. */
  readonly sub: string;
  /** Guidance paragraph for the "How to run it" card. */
  readonly note: string;
  /** Whether the session's minutes count toward the weekly aerobic goal. */
  readonly aerobic: boolean;
  /** Default minutes for time-based sessions. Absent for pure strength days. */
  readonly minutes?: number;
  /**
   * Station ids offering this day's cardio or activity, best first.
   *
   * Referencing stations rather than free strings means the club's real
   * equipment drives the choices, and a busy treadmill can offer the same
   * swap flow as a busy bench.
   */
  readonly modalityStations?: readonly string[];
  /** Movements to log. Absent for pure duration days. */
  readonly exercises?: readonly Exercise[];
  /** Stations suggested for the mobility or cooldown portion. */
  readonly mobilityStations?: readonly string[];
}

/* -------------------------------------------------------------- persistence */

/** A single logged working set. */
export interface LoggedSet {
  /** References `Exercise.id`. */
  readonly exerciseId: string;
  /** Load as entered by the user, in `unit`. Zero for bodyweight movements. */
  readonly weight: number;
  readonly unit: WeightUnit;
  /** Reps, or seconds when the exercise's `repMetric` is `seconds`. */
  readonly reps: number;
  /** Epoch milliseconds, used for ordering and undo. */
  readonly loggedAt: number;
  /**
   * Which station the set was actually performed on.
   *
   * Absent on sets logged before stations existed, and on movements that have
   * no station options. Recorded because a swap changes what the number means:
   * 180 on the leg press and 180 on the hack squat are not the same lift, and
   * a trend chart that silently mixes them is lying.
   */
  readonly stationId?: string;
}

/**
 * A training session, either in progress (`Session` held in `AppState.active`)
 * or finished (pushed onto `AppState.sessions`).
 */
export interface Session {
  /** Stable unique id. Assigned at creation, not at completion. */
  readonly id: string;
  /** The calendar date the work was actually done. */
  readonly date: IsoDate;
  /** Which plan day was followed. May differ from the weekday of `date`. */
  readonly dayKey: DayKey;
  readonly sets: readonly LoggedSet[];
  /** Duration in minutes for time-based work. `null` when not applicable. */
  readonly minutes: number | null;
  /** Chosen cardio modality, when the day offers a choice. */
  readonly modality: string | null;
  readonly effort: Effort | null;
  /** Epoch milliseconds when the session was started. */
  readonly startedAt: number;
  /** Epoch milliseconds when the session was finished. Absent while active. */
  readonly finishedAt?: number;
}

/** User preferences. Additive only — unknown keys are dropped on load. */
export interface Preferences {
  /** Unit used for entry and display. Stored sets keep their own unit. */
  readonly unit: WeightUnit;
  /** Last exercise selected in the History trend picker. */
  readonly trendExerciseId?: string;
  /** Whether the rest timer vibrates on completion, where supported. */
  readonly restVibrate: boolean;
  /**
   * Stations the user has marked as not present at their club.
   *
   * The equipment catalogue is partly inferred from the chain's usual lineup
   * rather than from a published inventory, so it will be wrong in places.
   * Rather than pretend otherwise, the app lets the floor correct the data:
   * anything marked missing here stops being suggested.
   */
  readonly missingStations?: readonly string[];
  /**
   * Per-exercise station preference, remembered across sessions.
   *
   * Once you have swapped an exercise to the machine you actually like, the
   * app should keep offering that one first instead of reverting.
   */
  readonly preferredStations?: Readonly<Record<string, string>>;
}

/** Weekly targets shown on the goals card. */
export interface Goals {
  /** Aerobic minutes per week. */
  readonly minutes: number;
  /** Strength sessions per week. */
  readonly strength: number;
}

/** The complete persisted state. Serialized to one storage key as JSON. */
export interface AppState {
  readonly schemaVersion: number;
  readonly sessions: readonly Session[];
  /** The session currently being logged, if any. */
  readonly active: Session | null;
  readonly prefs: Preferences;
}

/* ------------------------------------------------------------------- views */

/** Top-level tabs. */
export type Tab = 'today' | 'history' | 'plan';
