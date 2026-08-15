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

/**
 * How a single working set felt.
 *
 * Deliberately three options rather than a reps-in-reserve count. Judging "I
 * had two left" accurately is a trained skill; "that was easy" is not. Three
 * buttons also survive being tapped one-handed while out of breath.
 *
 * Distinct from `Effort`, which describes a whole cardio session.
 */
export type SetEffort = 'easy' | 'right' | 'hard';

/** Training experience, used only to pick a safe first weight. */
export type FitnessLevel = 'new' | 'returning' | 'experienced';

/**
 * Optional profile, collected once, used to estimate opening weights.
 *
 * Nothing here leaves the device, and the app works without it — an absent
 * profile just means the first set of each movement opens at zero and you dial
 * it in yourself.
 */
export interface UserProfile {
  /** Years. Used to taper the starting estimate slightly with age. */
  readonly age: number;
  readonly bodyweight: number;
  readonly bodyweightUnit: WeightUnit;
  readonly level: FitnessLevel;
  /** When the profile was captured, so stale bodyweights can be spotted. */
  readonly recordedOn: IsoDate;
}

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
 * A piece of equipment or a space in a gym.
 *
 * The catalogue is a *vocabulary of common gym equipment*, not an inventory of
 * any particular building. The app cannot know what is on your floor, so it
 * does not pretend to: every station is treated as possibly-present until you
 * say otherwise, and `Preferences.missingStations` is the only record of what
 * your gym actually lacks. The floor corrects the data, not the other way
 * round.
 */
export interface Station {
  readonly id: string;
  readonly name: string;
  readonly kind: StationKind;
  readonly zone: Zone;
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
 * Where an exercise's definition came from.
 *
 * `builtin` movements live in `data/exercises.ts` and carry everything the app
 * knows how to do — station substitutions, load conversions, a bodyweight
 * factor for the opening estimate. `plan` movements were written by whichever
 * LLM produced an imported plan, and carry only what that file supplied.
 *
 * The distinction is surfaced, not hidden. A movement someone's chatbot
 * invented last Tuesday should not be presented with the same authority as one
 * that has been through this codebase.
 */
export type ExerciseSource = 'builtin' | 'plan';

/**
 * One movement in the plan.
 *
 * `id` is a stable persistence key: logged sets reference it forever, so
 * renaming an exercise is safe but changing its id orphans history.
 */
export interface Exercise {
  readonly id: string;
  readonly name: string;
  /** Absent on the built-in catalogue, which is the default. */
  readonly source?: ExerciseSource;
  /**
   * Equipment needed, in plain English, e.g. `adjustable bench, dumbbells`.
   *
   * Only imported movements set this. The app cannot enumerate the equipment
   * of every gym on earth, so for anything outside the built-in vocabulary it
   * shows the author's own words rather than pretending to resolve them.
   */
  readonly equipment?: string;
  /**
   * Load to open the very first set of a movement with no logged history.
   *
   * Supplied by the author of an imported plan, and used exactly once: the
   * moment there is one real logged set, `domain/progression.ts` takes over
   * and this is never consulted again. It is a starting guess from someone who
   * knows the movement, not a prescription — the app still rounds it down and
   * still says on screen that it is a floor to work up from.
   */
  readonly openingWeight?: {
    readonly value: number;
    readonly unit: WeightUnit;
  };
  /** Equipment-free or lighter substitute, shown as "or ..." on the card. */
  readonly alternative?: string;
  /**
   * One plain sentence saying what the movement actually is.
   *
   * Always visible, unlike the cues, which are collapsed. Exercise names are
   * jargon — "dead bug" and "bird dog" tell a newcomer nothing — and a name you
   * cannot picture is a movement you skip.
   */
  readonly summary?: string;
  /** Target working sets. Drives the set dots and the auto-advance. */
  readonly sets: number;
  /** Human-readable target, e.g. `8–12` or `20–30`. Display only. */
  readonly repRange: string;
  /**
   * The rep range as numbers, which is what progression actually runs on.
   *
   * Held separately from `repRange` rather than parsed out of it: that string
   * is display copy and carries things like `8–10 / leg`, and a progression
   * engine that depends on parsing prose is one copy edit from breaking.
   */
  readonly repMin: number;
  readonly repMax: number;
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
  /**
   * Opening load as a fraction of bodyweight, for someone new to lifting.
   *
   * Used once, to answer "what do I even put on this thing" on the first
   * session. Absent for bodyweight movements. These are deliberately timid —
   * see `domain/startingWeights.ts` for why they should stay that way.
   */
  readonly bodyweightFactor?: number;
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
  /**
   * The session broken into ordered parts, shown at the top of the day.
   *
   * Exists because the logging UI shows one exercise at a time, which makes a
   * six-movement session look like a one-movement session. The outline answers
   * "what am I actually doing today" before any of that.
   */
  readonly outline: readonly string[];
  /**
   * How the exercises are performed as a group.
   *
   * `circuit` means all of them, repeated for rounds — the rail is a sequence,
   * not a menu. `sets` means work through each one before moving on.
   */
  readonly exerciseFormat?: 'circuit' | 'sets';
  /** Rounds through the circuit, e.g. `2–3`. Only meaningful for circuits. */
  readonly rounds?: string;
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
  /** How the set felt. Absent when the user did not say. */
  readonly effort?: SetEffort;
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
  /**
   * Wall-clock length of the session in minutes, start to finish.
   *
   * Deliberately *not* `minutes`. That field is aerobic work time and feeds the
   * weekly cardio goal; this one is how long you were in the building. Folding
   * a 70-minute strength session into `minutes` would report 70 minutes of
   * cardio that never happened.
   *
   * Absent when the session was never explicitly finished — an overnight
   * session's elapsed time is the time the app was closed, not time trained.
   */
  readonly durationMinutes?: number;
  /**
   * The plan day's label as it read when the session was logged.
   *
   * History renders this rather than looking the label up. Once plans can be
   * regenerated, a lookup would retroactively relabel old sessions — a Tuesday
   * logged as "Strength A" would silently become whatever Tuesday is called
   * now. The snapshot keeps the record true to what actually happened.
   */
  readonly planLabel?: string;
}

/* ------------------------------------------------------------- user plans */

/**
 * One day of a plan the user brought, rather than the built-in rotation.
 *
 * Narrower than `PlanDay` because the parts the app owns — accent colour,
 * plate weight, resolved `Exercise` objects — are filled in on resolution
 * rather than stored. What is stored is the author's structural intent.
 */
export interface UserPlanDay {
  readonly dayKey: DayKey;
  readonly label: string;
  readonly type: SessionType | 'rest';
  readonly sub: string;
  readonly note: string;
  readonly outline: readonly string[];
  readonly aerobic: boolean;
  readonly minutes?: number;
  /** Station ids from the built-in vocabulary. */
  readonly modalityStations?: readonly string[];
  /**
   * How the day's cardio is done, in the author's words.
   *
   * The escape hatch from the station vocabulary. A plan written for a gym the
   * app has never heard of can say "the assault bike by the door" and have it
   * render, instead of being rejected for naming equipment not on a list.
   */
  readonly modality?: string;
  /**
   * Movements for the day, referencing either the built-in catalogue or an
   * exercise defined by this plan.
   */
  readonly exerciseIds?: readonly string[];
  readonly exerciseFormat?: 'circuit' | 'sets';
  readonly rounds?: string;
}

/**
 * A complete week the user adopted, and where it came from.
 *
 * Covers both plans generated in-app and plans written by an external LLM and
 * imported — they are the same thing by the time they get here, which is the
 * point. One shape, one validator, one resolution path.
 */
export interface UserPlan {
  readonly id: string;
  /**
   * What the user calls this plan, once it is one of several.
   *
   * Absent on plans saved before the library existed, and on anything the
   * user has not renamed — `describePlanName` falls back to the model and
   * date, which is how they were identified before.
   */
  readonly name?: string;
  /** One line on the approach taken, shown before you accept it. */
  readonly summary: string;
  readonly days: readonly UserPlanDay[];
  /**
   * Movements this plan defines for itself, beyond the built-in catalogue.
   *
   * Stored with the plan rather than merged into the catalogue: these are the
   * plan's own vocabulary, and they must disappear along with it. Their ids
   * are namespaced (see `CUSTOM_ID_PREFIX`) so they can never collide with a
   * built-in id and silently rewrite the meaning of logged history.
   */
  readonly exercises?: readonly Exercise[];
  /** Epoch milliseconds the plan was adopted. */
  readonly generatedAt: number;
  /**
   * Who wrote it — a model name, or whatever an imported file declared.
   *
   * Free text and never trusted for anything: it exists so that when two plans
   * differ and you wonder why, there is an answer on screen.
   */
  readonly model: string;
}

/** What the user tells the model about themselves. */
export interface PlanRequest {
  readonly profile?: UserProfile;
  /** Free-text health context, e.g. `high cholesterol`. */
  readonly conditions: readonly string[];
  /** Anything to work around this week, e.g. `sore left shoulder`. */
  readonly notes: string;
  /** Station ids the user has not marked missing. */
  readonly availableStationIds: readonly string[];
  /** Where the user trains, in their own words. */
  readonly gym?: string;
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
   * Stations the user has marked as not present at their gym.
   *
   * The equipment catalogue is a vocabulary of common gym equipment, not an
   * inventory of anyone's building, so it will be wrong in places. Rather than
   * pretend otherwise, the app lets the floor correct it: anything marked
   * missing here stops being suggested.
   */
  readonly missingStations?: readonly string[];
  /**
   * Free-text description of where the user trains and what it has.
   *
   * Deliberately prose rather than structured data. The app does not need to
   * parse it — its job is to be pasted into the prompt the user hands their
   * LLM, which is the thing that actually needs to know whether there is a
   * squat rack. Structuring it would mean maintaining an equipment ontology
   * broad enough for every gym on earth, to serve a consumer that reads
   * English perfectly well.
   */
  readonly gym?: string;
  /**
   * Per-exercise station preference, remembered across sessions.
   *
   * Once you have swapped an exercise to the machine you actually like, the
   * app should keep offering that one first instead of reverting.
   */
  readonly preferredStations?: Readonly<Record<string, string>>;
  /** Set during onboarding. Absent until then, and the app works without it. */
  readonly profile?: UserProfile;
  /** True once onboarding has been shown, so it is not offered again. */
  readonly onboarded?: boolean;
  /*
   * Health context deliberately does not live here.
   *
   * It was a persisted preference so it would not have to be retyped — a real
   * convenience and the wrong trade. It turned a sentence typed once into a
   * medical detail held in browser storage indefinitely, and under accounts it
   * would have become one held in a database. It is now per-session input, in
   * `state/ephemeral.ts`, used for one generation and gone.
   */
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
  /**
   * Every plan the user has kept, oldest first.
   *
   * A library rather than a single slot. Adopting a plan used to overwrite the
   * previous one, so trying a week your LLM wrote meant destroying the block
   * you had been running — and the only way back was to still have the file.
   * Training is seasonal: a winter strength block, a travel week and a rehab
   * plan are all worth keeping and switching between.
   */
  readonly plans: readonly UserPlan[];
  /**
   * Which plan in `plans` is in force.
   *
   * `null` means the built-in rotation applies, which is also what an id that
   * no longer resolves falls back to. The built-in plan is never in `plans` —
   * it lives in `data/plan.ts` and cannot be deleted, so there is always a
   * known-good week underneath whatever the user is trying.
   */
  readonly activePlanId: string | null;
  /**
   * Definitions of plan-defined movements that have been logged against.
   *
   * A custom movement lives in the plan that defined it, so replacing the plan
   * would otherwise strand every set logged against it: the sets survive, but
   * nothing can say what `x:sled-push` was, whether it was measured in reps or
   * seconds, or whether it belongs on a strength trend.
   *
   * So the definition is copied here the first time a set is logged against
   * it, and kept for as long as the history is. Written on logging rather than
   * on plan replacement because that is the moment the movement stops being a
   * suggestion and becomes part of the record — and because it means the
   * archive holds only what was actually performed, not every movement of
   * every plan ever tried.
   */
  readonly exerciseArchive: readonly Exercise[];
}

/* ------------------------------------------------------------------- views */

/** Top-level tabs. */
export type Tab = 'today' | 'history' | 'plan';
