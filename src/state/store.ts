import type {
  AppState,
  DayKey,
  Effort,
  UserPlan,
  LoggedSet,
  Session,
  SetEffort,
  UserProfile,
  WeightUnit,
} from '@/types';
import { activePlan } from '@/data/catalogue';
import { todayIso } from '@/domain/dates';
import { clampMinutes, clampReps, clampWeight } from '@/domain/limits';
import { type KeyValueStore, type SaveFailure, debounce, saveState } from './storage';

/**
 * The application store.
 *
 * A single immutable `AppState` with named actions and a subscription list.
 * Deliberately not a general-purpose reactive library: the app has one state
 * tree and three views, and a full framework would be more machinery than the
 * problem needs.
 *
 * Every mutation goes through an action so that persistence and re-rendering
 * happen in exactly one place. Nothing outside this module may reach into the
 * state object.
 */

export type Listener = (state: AppState) => void;

/** Reported when a write fails, so the UI can warn instead of losing data quietly. */
export type SaveErrorHandler = (failure: SaveFailure) => void;

/** Reported when an in-progress session was filed to make room for another. */
export type SessionFiledHandler = (session: Session) => void;

export interface StoreOptions {
  readonly initialState: AppState;
  readonly store: KeyValueStore;
  /** Debounce window for writes. Zero writes synchronously, which tests want. */
  readonly saveDelayMs?: number;
  readonly onSaveError?: SaveErrorHandler;
  /** Called when starting one day's session auto-files another. */
  readonly onSessionFiled?: SessionFiledHandler;
  /** Supplies the current label for a plan day, snapshotted onto new sessions. */
  readonly planLabel?: (dayKey: DayKey) => string;
  /** Clock seam so tests can produce deterministic timestamps. */
  readonly now?: () => number;
}

export class AppStore {
  #state: AppState;
  readonly #listeners = new Set<Listener>();
  readonly #persist: ((state: AppState) => void) & { flush(): void };
  readonly #now: () => number;
  readonly #onSessionFiled: SessionFiledHandler | undefined;
  /** Resolves a day's current label, for snapshotting onto new sessions. */
  readonly #planLabel: ((dayKey: DayKey) => string) | undefined;

  constructor(options: StoreOptions) {
    this.#state = options.initialState;
    this.#now = options.now ?? (() => Date.now());
    this.#onSessionFiled = options.onSessionFiled;
    this.#planLabel = options.planLabel;

    const write = (state: AppState): void => {
      const failure = saveState(options.store, state);
      if (failure !== null) options.onSaveError?.(failure);
    };

    const delay = options.saveDelayMs ?? 250;
    this.#persist = delay > 0 ? debounce(write, delay) : Object.assign(write, { flush: () => {} });
  }

  getState(): AppState {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Force any pending debounced write to complete. Called before unload. */
  flush(): void {
    this.#persist.flush();
  }

  #commit(next: AppState): void {
    if (next === this.#state) return;
    this.#state = next;
    this.#persist(next);
    for (const listener of this.#listeners) listener(next);
  }

  /* ---------------------------------------------------------- preferences */

  setUnit(unit: WeightUnit): void {
    this.#commit({ ...this.#state, prefs: { ...this.#state.prefs, unit } });
  }

  /**
   * Add a plan to the library and make it the one in force.
   *
   * Adopting a plan no longer discards the previous one — that is the whole
   * point of the library. Re-adopting a plan already present replaces it in
   * place rather than adding a duplicate, so regenerating and accepting does
   * not fill the list with near-identical weeks.
   */
  adoptPlan(plan: UserPlan): void {
    const existing = this.#state.plans.findIndex((saved) => saved.id === plan.id);
    const plans =
      existing === -1
        ? [...this.#state.plans, plan]
        : this.#state.plans.map((saved, i) => (i === existing ? plan : saved));

    this.#commit({ ...this.#state, plans, activePlanId: plan.id });
  }

  /**
   * Switch to a saved plan, or to the built-in rotation with `null`.
   *
   * An id not in the library is ignored rather than selected, so a stale
   * reference cannot leave the app pointing at nothing.
   */
  selectPlan(planId: string | null): void {
    if (planId !== null && !this.#state.plans.some((plan) => plan.id === planId)) return;
    this.#commit({ ...this.#state, activePlanId: planId });
  }

  /**
   * Remove a plan from the library.
   *
   * Deleting the plan in force falls back to the built-in rotation. Logged
   * history is untouched: sets reference exercise ids, and any custom movement
   * that was actually performed is in `exerciseArchive`, which is exactly the
   * situation that field exists for.
   */
  deletePlan(planId: string): void {
    const plans = this.#state.plans.filter((plan) => plan.id !== planId);
    if (plans.length === this.#state.plans.length) return;

    this.#commit({
      ...this.#state,
      plans,
      activePlanId: this.#state.activePlanId === planId ? null : this.#state.activePlanId,
    });
  }

  /** Rename a saved plan. A blank name clears it, restoring the default label. */
  renamePlan(planId: string, name: string): void {
    const trimmed = name.trim().slice(0, 80);

    this.#commit({
      ...this.#state,
      plans: this.#state.plans.map((plan) => {
        if (plan.id !== planId) return plan;
        const { name: _previous, ...rest } = plan;
        return trimmed ? { ...rest, name: trimmed } : rest;
      }),
    });
  }

  /** Save the onboarding profile used to estimate opening weights. */
  setProfile(profile: UserProfile): void {
    this.#commit({
      ...this.#state,
      prefs: { ...this.#state.prefs, profile, onboarded: true },
    });
  }

  /** Record that onboarding has been offered, whether or not it was filled in. */
  setOnboarded(onboarded: boolean): void {
    this.#commit({ ...this.#state, prefs: { ...this.#state.prefs, onboarded } });
  }

  setRestVibrate(enabled: boolean): void {
    this.#commit({ ...this.#state, prefs: { ...this.#state.prefs, restVibrate: enabled } });
  }

  setTrendExercise(exerciseId: string): void {
    this.#commit({ ...this.#state, prefs: { ...this.#state.prefs, trendExerciseId: exerciseId } });
  }

  /**
   * Remember which station this exercise should open on next time.
   *
   * Swapping is not a one-off correction — if the machine circuit is always
   * packed at your hour, the alternative is your real default.
   */
  setPreferredStation(exerciseId: string, stationId: string): void {
    const preferredStations = { ...this.#state.prefs.preferredStations, [exerciseId]: stationId };
    this.#commit({ ...this.#state, prefs: { ...this.#state.prefs, preferredStations } });
  }

  /**
   * Where the user trains, in their own words.
   *
   * Trimmed and cleared when blank, so an emptied box does not persist as a
   * meaningless empty string that later gets pasted into a prompt.
   */
  setGym(gym: string): void {
    const trimmed = gym.trim();
    const { gym: _previous, ...rest } = this.#state.prefs;

    this.#commit({ ...this.#state, prefs: trimmed ? { ...rest, gym: trimmed } : rest });
  }

  /**
   * Mark a station as present or absent at the user's gym.
   *
   * The catalogue is a vocabulary of common equipment rather than an inventory
   * of anyone's building, so this is how the floor corrects it.
   */
  setStationMissing(stationId: string, missing: boolean): void {
    const current = new Set(this.#state.prefs.missingStations ?? []);
    if (missing) current.add(stationId);
    else current.delete(stationId);

    this.#commit({
      ...this.#state,
      prefs: { ...this.#state.prefs, missingStations: [...current].sort() },
    });
  }

  /* ------------------------------------------------------ active sessions */

  /**
   * The in-progress session for a plan day, but only when it belongs to today.
   *
   * A session left open overnight is intentionally not returned here — it is
   * surfaced separately by `staleActive()` so the user decides what happens to
   * it instead of it being silently reused or dropped.
   */
  activeFor(dayKey: DayKey): Session | null {
    const active = this.#state.active;
    if (!active) return null;
    return active.dayKey === dayKey && active.date === todayIso() ? active : null;
  }

  /**
   * An unfinished session carried over from an earlier day, if one exists.
   *
   * v0.1 discarded these on load, losing whatever had been logged. Now they are
   * kept and the Today view offers to save or discard them.
   */
  staleActive(): Session | null {
    const active = this.#state.active;
    if (!active || active.date === todayIso()) return null;
    return active;
  }

  /** True when the active session holds nothing worth keeping. */
  static isEmptySession(session: Session): boolean {
    return session.sets.length === 0 && !session.minutes;
  }

  #newSession(dayKey: DayKey): Session {
    return {
      id: `s${this.#now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      date: todayIso(),
      dayKey,
      sets: [],
      minutes: null,
      modality: null,
      effort: null,
      startedAt: this.#now(),
      // Snapshot the label now. Looking it up later would retroactively rename
      // past sessions every time the plan is regenerated.
      ...(this.#planLabel ? { planLabel: this.#planLabel(dayKey) } : {}),
    };
  }

  /**
   * Make room for a session on `dayKey`, preserving anything already in
   * progress for a different day.
   *
   * There is one active slot, so starting Tuesday's session while Monday's is
   * open has to do something with Monday's. Overwriting it would destroy real
   * logged work — which is exactly what happened before this guard existed, if
   * you tapped through to another day from the week strip and logged a set.
   * Instead the displaced session is filed into history, where it can be seen,
   * edited or deleted. Empty sessions are simply dropped.
   */
  #displace(dayKey: DayKey): readonly Session[] {
    const active = this.#state.active;
    if (!active) return this.#state.sessions;
    if (active.dayKey === dayKey && active.date === todayIso()) return this.#state.sessions;

    if (AppStore.isEmptySession(active)) return this.#state.sessions;

    this.#onSessionFiled?.(active);
    return sortSessions([...this.#state.sessions, { ...active, finishedAt: this.#now() }]);
  }

  /** Apply a change to the active session for `dayKey`, creating it if needed. */
  #updateActive(dayKey: DayKey, change: (session: Session) => Session): void {
    const sessions = this.#displace(dayKey);
    const base = this.activeFor(dayKey) ?? this.#newSession(dayKey);
    this.#commit({ ...this.#state, sessions, active: change(base) });
  }

  /**
   * Open a session for `dayKey` now, before anything has been logged.
   *
   * Sessions were created lazily by the first logged set, which meant
   * `startedAt` recorded the first working set rather than the start of the
   * workout — the warm-up, the walk to a machine and the wait for it all fell
   * outside. Starting explicitly is what makes the recorded duration mean "how
   * long I trained".
   *
   * A no-op when the day's session is already open, so it can be called
   * defensively without resetting the clock.
   */
  startSession(dayKey: DayKey): void {
    if (this.activeFor(dayKey)) return;
    this.#updateActive(dayKey, (session) => session);
  }

  /* -------------------------------------------------------------- logging */

  /** Record one working set. Inputs are clamped before they reach the state. */
  logSet(
    dayKey: DayKey,
    exerciseId: string,
    weight: number,
    reps: number,
    unit: WeightUnit,
    stationId?: string,
    effort?: SetEffort,
  ): void {
    const set: LoggedSet = {
      exerciseId,
      weight: clampWeight(weight),
      reps: clampReps(reps),
      unit,
      loggedAt: this.#now(),
      // Recorded so history and trends can tell a leg press from a hack squat.
      ...(stationId === undefined ? {} : { stationId }),
      // Drives progression. Absent when the user chose not to say.
      ...(effort === undefined ? {} : { effort }),
    };
    this.#archiveExercise(exerciseId);
    this.#updateActive(dayKey, (session) => ({ ...session, sets: [...session.sets, set] }));
  }

  /**
   * Keep a copy of a plan-defined movement the moment it is first logged.
   *
   * Without this, replacing the plan strands the sets: they survive, but
   * nothing can say what `x:sled-push` was, whether it counted reps or
   * seconds, or whether it belongs on a strength trend.
   *
   * A no-op for built-in movements and for anything already archived. The
   * archived copy is deliberately not refreshed afterwards — it records the
   * movement as it was described when the work was done, which is what makes
   * the history true rather than merely current.
   */
  #archiveExercise(exerciseId: string): void {
    const definition = activePlan(this.#state)?.exercises?.find((exercise) => exercise.id === exerciseId);
    if (!definition) return;
    if (this.#state.exerciseArchive.some((exercise) => exercise.id === exerciseId)) return;

    this.#commit({
      ...this.#state,
      exerciseArchive: [...this.#state.exerciseArchive, definition],
    });
  }

  /** Remove the most recently logged set for one exercise. */
  undoLastSet(dayKey: DayKey, exerciseId: string): void {
    const active = this.activeFor(dayKey);
    if (!active) return;

    const index = active.sets.findLastIndex((set) => set.exerciseId === exerciseId);
    if (index === -1) return;

    const sets = [...active.sets];
    sets.splice(index, 1);
    this.#commit({ ...this.#state, active: { ...active, sets } });
  }

  setMinutes(dayKey: DayKey, minutes: number): void {
    this.#updateActive(dayKey, (session) => ({ ...session, minutes: clampMinutes(minutes) }));
  }

  /** Set the cardio modality, or clear it when the same one is chosen again. */
  toggleModality(dayKey: DayKey, modality: string, fallbackMinutes: number | null): void {
    this.#updateActive(dayKey, (session) => ({
      ...session,
      modality: session.modality === modality ? null : modality,
      minutes: session.minutes ?? (fallbackMinutes === null ? null : clampMinutes(fallbackMinutes)),
    }));
  }

  /** Set perceived effort, or clear it when the same value is chosen again. */
  toggleEffort(dayKey: DayKey, effort: Effort, fallbackMinutes: number | null): void {
    this.#updateActive(dayKey, (session) => ({
      ...session,
      effort: session.effort === effort ? null : effort,
      minutes: session.minutes ?? (fallbackMinutes === null ? null : clampMinutes(fallbackMinutes)),
    }));
  }

  /* ------------------------------------------------------ finishing sessions */

  /**
   * Move the active session into history.
   *
   * Returns false when there is nothing to save, so the caller can explain why
   * rather than appearing to do nothing.
   */
  finishActive(dayKey: DayKey, defaultMinutes: number | null): boolean {
    // File any session in progress for another day before building this one,
    // so finishing Tuesday cannot discard an open Monday.
    const sessions = this.#displace(dayKey);
    const active = this.activeFor(dayKey) ?? this.#newSession(dayKey);

    const minutes = active.minutes ?? (defaultMinutes === null ? null : clampMinutes(defaultMinutes));
    const finishedAt = this.#now();
    const candidate: Session = {
      ...active,
      minutes,
      finishedAt,
      // Measured start to finish, so it covers the whole workout rather than
      // just the logged work. `startedAt` is zero on sessions restored from
      // storage written before it was recorded; those get no duration rather
      // than a fifty-year one.
      ...(active.startedAt > 0 && finishedAt > active.startedAt
        ? { durationMinutes: clampMinutes(Math.round((finishedAt - active.startedAt) / 60_000)) }
        : {}),
    };

    if (AppStore.isEmptySession(candidate)) {
      // Still commit the displacement, or the preserved session would be lost.
      if (sessions !== this.#state.sessions) {
        this.#commit({ ...this.#state, sessions, active: null });
      }
      return false;
    }

    this.#commit({
      ...this.#state,
      sessions: sortSessions([...sessions, candidate]),
      active: null,
    });
    return true;
  }

  /** Save a session carried over from a previous day, keeping its own date. */
  keepStaleActive(): boolean {
    const stale = this.staleActive();
    if (!stale || AppStore.isEmptySession(stale)) return false;

    this.#commit({
      ...this.#state,
      sessions: sortSessions([...this.#state.sessions, { ...stale, finishedAt: this.#now() }]),
      active: null,
    });
    return true;
  }

  /** Throw away the in-progress session without saving it. */
  discardActive(): void {
    if (!this.#state.active) return;
    this.#commit({ ...this.#state, active: null });
  }

  /**
   * Move a finished session back into the active slot so more can be added.
   *
   * Refuses when another session is already in progress, rather than silently
   * discarding it.
   */
  reopenSession(id: string): boolean {
    if (this.#state.active) return false;

    const session = this.#state.sessions.find((s) => s.id === id);
    if (!session) return false;

    // The duration goes back with the finish stamp. Keeping a duration on a
    // session that is running again would show a stopped clock; it is
    // re-measured from the original `startedAt` when the session is finished
    // for good.
    const { finishedAt: _finishedAt, durationMinutes: _durationMinutes, ...reopened } = session;
    this.#commit({
      ...this.#state,
      sessions: this.#state.sessions.filter((s) => s.id !== id),
      active: reopened,
    });
    return true;
  }

  deleteSession(id: string): void {
    const sessions = this.#state.sessions.filter((s) => s.id !== id);
    if (sessions.length === this.#state.sessions.length) return;
    this.#commit({ ...this.#state, sessions });
  }

  /* --------------------------------------------------------- import/export */

  /** Replace everything, as when restoring a backup. */
  replaceState(state: AppState): void {
    this.#commit({ ...state, sessions: sortSessions([...state.sessions]) });
  }
}

/** Oldest first, with a stable tie-break so equal dates keep a fixed order. */
function sortSessions(sessions: Session[]): Session[] {
  return sessions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
}
