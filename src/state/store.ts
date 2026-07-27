import type { AppState, DayKey, Effort, LoggedSet, Session, WeightUnit } from '@/types';
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
  /** Clock seam so tests can produce deterministic timestamps. */
  readonly now?: () => number;
}

export class AppStore {
  #state: AppState;
  readonly #listeners = new Set<Listener>();
  readonly #persist: ((state: AppState) => void) & { flush(): void };
  readonly #now: () => number;
  readonly #onSessionFiled: SessionFiledHandler | undefined;

  constructor(options: StoreOptions) {
    this.#state = options.initialState;
    this.#now = options.now ?? (() => Date.now());
    this.#onSessionFiled = options.onSessionFiled;

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
   * Mark a station as present or absent at the user's club.
   *
   * The equipment catalogue is partly inferred from the chain's usual lineup,
   * so this is how the floor corrects it.
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

  /* -------------------------------------------------------------- logging */

  /** Record one working set. Inputs are clamped before they reach the state. */
  logSet(
    dayKey: DayKey,
    exerciseId: string,
    weight: number,
    reps: number,
    unit: WeightUnit,
    stationId?: string,
  ): void {
    const set: LoggedSet = {
      exerciseId,
      weight: clampWeight(weight),
      reps: clampReps(reps),
      unit,
      loggedAt: this.#now(),
      // Recorded so history and trends can tell a leg press from a hack squat.
      ...(stationId === undefined ? {} : { stationId }),
    };
    this.#updateActive(dayKey, (session) => ({ ...session, sets: [...session.sets, set] }));
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
    const candidate: Session = { ...active, minutes, finishedAt: this.#now() };

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

    const { finishedAt: _finishedAt, ...reopened } = session;
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
