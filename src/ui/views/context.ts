import type { AppState, DayKey, PlanDay, SetEffort, Tab } from '@/types';
import type { AppStore } from '@/state/store';
import type { RestTimer } from '../restTimer';

/** Transient interface state. Not persisted — it resets on reload by design. */
export interface UiState {
  tab: Tab;
  /** The plan day being viewed, or `null` to follow the real current day. */
  viewDay: DayKey | null;
  /** Index into the current day's exercise list. */
  exerciseIndex: number;
  /** Exercise id whose swap sheet is open, or null when none is. */
  swapOpenFor: string | null;
  /**
   * Station chosen for an exercise during this session, by exercise id.
   *
   * Transient on purpose. The durable version of this is
   * `Preferences.preferredStations`; this layer only holds "the bench was busy
   * five minutes ago", which should not outlive the session.
   */
  stationByExercise: Record<string, string>;
  /**
   * Uncommitted stepper values, by exercise id.
   *
   * The exercise card is rebuilt from scratch on every render, so without this
   * a weight typed in but not yet logged would be thrown away by any unrelated
   * re-render — opening the swap sheet, flagging a machine, switching tabs.
   * Cleared once the set is logged, so the next set re-seeds from history.
   */
  draftByExercise: Record<string, { weight: number; reps: number }>;
  /** Effort chosen for the set about to be logged, by exercise id. */
  effortByExercise: Record<string, SetEffort | undefined>;
}

/** Everything a view needs to render itself and to request a re-render. */
export interface ViewContext {
  readonly store: AppStore;
  readonly state: AppState;
  /**
   * The plan in force, generated or built-in, already resolved to real
   * catalogue objects. Views read this rather than importing `PLAN`, so a
   * generated plan takes effect everywhere at once.
   */
  readonly plan: Readonly<Record<DayKey, PlanDay>>;
  readonly rest: RestTimer;
  readonly ui: UiState;
  /** Re-render the current view from current state. */
  readonly render: () => void;
}
