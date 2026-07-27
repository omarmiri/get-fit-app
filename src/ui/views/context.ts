import type { AppState, DayKey, Tab } from '@/types';
import type { AppStore } from '@/state/store';
import type { RestTimer } from '../restTimer';

/** Transient interface state. Not persisted — it resets on reload by design. */
export interface UiState {
  tab: Tab;
  /** The plan day being viewed, or `null` to follow the real current day. */
  viewDay: DayKey | null;
  /** Index into the current day's exercise list. */
  exerciseIndex: number;
}

/** Everything a view needs to render itself and to request a re-render. */
export interface ViewContext {
  readonly store: AppStore;
  readonly state: AppState;
  readonly rest: RestTimer;
  readonly ui: UiState;
  /** Re-render the current view from current state. */
  readonly render: () => void;
}
