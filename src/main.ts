import { registerSW } from 'virtual:pwa-register';

import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo/latin-800.css';
import '@fontsource/chivo-mono/latin-400.css';
import '@fontsource/chivo-mono/latin-700.css';
import './styles/index.css';

import { App, createSaveErrorReporter } from './app';
import { resolvePlan } from './data/activePlan';
import { activePlan } from './data/catalogue';
import { AppStore } from './state/store';
import { loadState, resolveBrowserStore } from './state/storage';
import { toast } from './ui/toast';
import { hasPendingPlan } from './ui/components/planImport';

/**
 * Entry point.
 *
 * Fonts are bundled rather than fetched from Google Fonts. The app claims to
 * work offline in a gym with no signal; a stylesheet on a third-party origin
 * would have broken that on any cold load, and self-hosting also removes a
 * third party from the request path.
 */

function boot(): void {
  const { store: keyValueStore, persistent } = resolveBrowserStore();
  const { state, migratedFromLegacy, dropped } = loadState(keyValueStore);

  const store: AppStore = new AppStore({
    initialState: state,
    store: keyValueStore,
    onSaveError: createSaveErrorReporter(),
    onSessionFiled: (filed) => {
      toast(`${filed.planLabel ?? 'Previous'} session saved to history`);
    },
    // Sessions snapshot their label at creation so regenerating the plan never
    // renames anything already logged.
    planLabel: (dayKey) => resolvePlan(activePlan(store.getState()))[dayKey].label,
  });

  new App(store).start();

  if (!persistent) {
    toast('Private browsing: this session will not be saved');
  } else if (migratedFromLegacy) {
    // Write the upgraded shape straight away. Without this the app would keep
    // re-reading the v0.1 key — and re-announcing the upgrade — on every launch
    // until the user happened to change something.
    store.replaceState(state);
    store.flush();
    toast(`Upgraded ${state.sessions.length} sessions from the previous version`);
  }

  if (dropped > 0) {
    toast(`${dropped} unreadable entries were skipped`);
  }

  registerUpdates();
}

/**
 * Offer the new build rather than swapping it in mid-session.
 *
 * Reloading underneath someone who is halfway through logging a set would be
 * hostile, so the update waits for an explicit confirmation — and is not
 * offered at all while a proposed workout plan is waiting for review, because
 * a reload would throw that plan away. It is offered again on the next return
 * to the app.
 *
 * ## Checking while the app stays open
 *
 * The browser only looks for a new service worker when the page loads. An
 * installed app on a phone can stay loaded for days, so a deploy went unseen
 * until something happened to reload it. It now also checks on coming back to
 * the app, at most every ten minutes.
 */
const UPDATE_CHECK_GAP_MS = 10 * 60 * 1000;

function registerUpdates(): void {
  let waiting = false;
  let lastCheck = Date.now();

  const offer = (): void => {
    if (!waiting || hasPendingPlan()) return;
    waiting = false;
    if (confirm('A new version of Rack & File is ready. Reload now?')) {
      void updateSW(true);
    }
  };

  const updateSW = registerSW({
    onNeedRefresh() {
      waiting = true;
      offer();
    },
    onOfflineReady() {
      toast('Ready to work offline');
    },
    onRegisteredSW(_url, registration) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        offer();
        if (!registration || Date.now() - lastCheck < UPDATE_CHECK_GAP_MS) return;
        lastCheck = Date.now();
        void registration.update().catch(() => {
          // Offline, most likely. The next return tries again.
        });
      });
    },
  });
}

boot();
