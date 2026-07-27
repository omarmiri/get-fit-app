import type { AppState, Tab } from '@/types';
import { PLAN } from '@/data/plan';
import { PLATE } from '@/data/plates';
import { todayDayKey } from '@/domain/dates';
import type { AppStore } from '@/state/store';
import { replaceChildren, requireElement } from '@/ui/dom';
import { RestTimer } from '@/ui/restTimer';
import { toast } from '@/ui/toast';
import type { UiState, ViewContext } from '@/ui/views/context';
import { renderHistoryView } from '@/ui/views/history';
import { renderPlanView } from '@/ui/views/plan';
import { renderTodayView } from '@/ui/views/today';
import { renderWeekStrip } from '@/ui/components/weekStrip';

/**
 * The application shell.
 *
 * Owns the transient interface state, wires the store to the DOM, and re-renders
 * the active view whenever state changes. Rendering is a full replace of the
 * view container — the tree is small enough that diffing would cost more in
 * complexity than it saves in time, and a full rebuild removes a whole class of
 * stale-node bugs.
 */

/** Accent colour for tabs that are not tied to a specific training day. */
const NEUTRAL_ACCENT = PLATE.white;

export class App {
  readonly #store: AppStore;
  readonly #rest: RestTimer;
  readonly #ui: UiState = {
    tab: 'today',
    viewDay: null,
    exerciseIndex: 0,
    swapOpenFor: null,
    stationByExercise: {},
    draftByExercise: {},
    effortByExercise: {},
  };

  readonly #weekStrip = requireElement('#week');
  readonly #view = requireElement('#view');
  readonly #nav = requireElement('#nav');

  /** Set when a render should return the user to the top of the page. */
  #scrollToTop = true;

  constructor(store: AppStore) {
    this.#store = store;
    this.#rest = new RestTimer({
      shouldVibrate: () => this.#store.getState().prefs.restVibrate,
    });

    this.#bindNav();

    // Flush any debounced write before the page goes away. `pagehide` fires on
    // mobile Safari where `beforeunload` does not.
    window.addEventListener('pagehide', () => this.#store.flush());

    this.#store.subscribe(() => this.#paint());
  }

  start(): void {
    this.render();
  }

  /** Re-render from current state. */
  render(): void {
    this.#paint();
  }

  /* ------------------------------------------------------------ rendering */

  #context(state: AppState): ViewContext {
    return {
      store: this.#store,
      state,
      rest: this.#rest,
      ui: this.#ui,
      render: () => {
        this.#scrollToTop = false;
        this.#paint();
      },
    };
  }

  #paint(): void {
    const state = this.#store.getState();
    const context = this.#context(state);

    this.#applyAccent();
    this.#paintWeekStrip(context);
    this.#paintNav();

    replaceChildren(this.#view, this.#viewChildren(context));

    if (this.#scrollToTop) window.scrollTo(0, 0);
    this.#scrollToTop = false;
  }

  #viewChildren(context: ViewContext): ReturnType<typeof renderTodayView> {
    switch (this.#ui.tab) {
      case 'today':
        return renderTodayView(context);
      case 'history':
        return renderHistoryView(context);
      case 'plan':
        return renderPlanView(context);
    }
  }

  /**
   * Tint the interface with the current day's plate colour.
   *
   * History and Plan are not day-specific, so they use a neutral accent rather
   * than inheriting whichever day happened to be open last.
   */
  #applyAccent(): void {
    const accent = this.#ui.tab === 'today' ? PLAN[this.#ui.viewDay ?? todayDayKey()].color : NEUTRAL_ACCENT;
    document.documentElement.style.setProperty('--pc', accent);
  }

  #paintWeekStrip(context: ViewContext): void {
    renderWeekStrip(this.#weekStrip, {
      state: context.state,
      selected: this.#ui.viewDay ?? todayDayKey(),
      onSelect: (day) => {
        this.#ui.viewDay = day;
        this.#ui.tab = 'today';
        this.#ui.exerciseIndex = 0;
        this.#ui.swapOpenFor = null;
        this.#scrollToTop = true;
        this.#paint();
      },
    });
  }

  #bindNav(): void {
    this.#nav.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      const tab = button?.dataset['tab'];
      if (!isTab(tab)) return;

      this.#ui.tab = tab;
      this.#ui.swapOpenFor = null;
      // Returning to Today should follow the real day again, not whichever day
      // was last browsed from the week strip.
      if (tab === 'today') this.#ui.viewDay = null;
      this.#scrollToTop = true;
      this.#paint();
    });
  }

  #paintNav(): void {
    for (const button of this.#nav.querySelectorAll<HTMLElement>('[data-tab]')) {
      const selected = button.dataset['tab'] === this.#ui.tab;
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    }
  }
}

function isTab(value: string | undefined): value is Tab {
  return value === 'today' || value === 'history' || value === 'plan';
}

/** Warn once when storage is unavailable or full, rather than on every write. */
export function createSaveErrorReporter(): (failure: 'quota' | 'unavailable') => void {
  let warned = false;
  return (failure) => {
    if (warned) return;
    warned = true;
    toast(
      failure === 'quota'
        ? 'Storage is full — export a backup and remove old sessions'
        : 'Could not save. Your browser is blocking local storage.',
    );
  };
}
