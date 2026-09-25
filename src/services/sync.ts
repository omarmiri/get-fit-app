import type { AppState } from '@/types';
import { todayIso } from '@/domain/dates';
import { CURRENT_SCHEMA_VERSION, defaultState, parseState } from '@/state/schema';
import { type SyncBase, fingerprint, hash, mergeStates, sameContent } from '@/state/merge';
import type { AppStore } from '@/state/store';
import { AccountError, currentUser, pullState, pushState } from './account';

/**
 * Keeping every signed-in device in step with the account.
 *
 * ## When
 *
 * On opening the app, on coming back to it, and half a minute after the last
 * change. Opening is the one that matters for the case this exists for —
 * write a plan on the PC, open the app at the gym — and coming back to the
 * foreground covers the phone that was left open in a pocket all week.
 *
 * ## Why it is quiet
 *
 * The device already has its data and has already persisted it before any of
 * this runs. So every failure here is survivable and none of them is worth a
 * dialog: no network in the gym is the expected case, not an error state. The
 * next trigger simply tries again.
 *
 * ## Not during a workout
 *
 * While today's session is open, nothing from another device is applied here.
 * A plan switched on the PC must not rearrange the screen someone is halfway
 * through.
 *
 * Nothing goes up either, except when the app is closed mid-workout or the
 * user asks. It used to upload half a minute after every logged set, and each
 * upload rewrites the whole history — twenty writes of the entire account per
 * workout, to back up data the phone had already saved locally. Finishing the
 * session is one sync, which is what the other device needs anyway.
 */

/** Long enough that a working set does not trigger its own upload. */
const QUIET_MS = 30_000;

/** Pulling on every return to the tab would be a request per rest period. */
const FOREGROUND_GAP_MS = 15_000;

/** Two devices would have to keep colliding this many times in a row. */
const MAX_ATTEMPTS = 3;

const BASE_KEY = 'rackfile:sync';

interface StoredBase {
  readonly uid: string;
  readonly updatedAt: number | null;
  readonly base: SyncBase;
  /** The in-progress workout as last pushed. Never merged, but still backed up. */
  readonly active?: string;
}

let store: AppStore | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;
/** Set while a merge is being applied, so applying it does not schedule another sync. */
let applying = false;
/** Changes made during a workout, held back until it ends or the app closes. */
let heldBack = false;

/** Wire sync to the store. Starts one sync straight away if signed in. */
export function initSync(appStore: AppStore): void {
  store = appStore;

  appStore.subscribe((state) => {
    if (applying || !currentUser()) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (workoutOpen(state)) {
      heldBack = true;
      return;
    }
    timer = setTimeout(() => void syncNow(), QUIET_MS);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > FOREGROUND_GAP_MS) {
      void syncNow();
    }
  });

  void syncNow();
}

/**
 * Pull, merge, push. Resolves when done; throws only when asked to report.
 *
 * Calls made while one is running are folded into a single rerun afterwards,
 * so a burst of triggers costs two syncs at most rather than a queue of them.
 */
export async function syncNow(options: { report?: boolean } = {}): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!store || !currentUser()) return;

  if (running) {
    again = true;
    return running;
  }

  lastRun = Date.now();
  running = run(store, options.report === true).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });

  if (options.report) return running;
  return running.catch(() => {
    // Quiet by design — see the module note. The next trigger retries.
  });
}

/**
 * Send this device's changes on the way out, if that needs no merge.
 *
 * A phone closing the app is exactly when the debounce has not fired, and
 * there is no time for a pull. A push against the version last synced is
 * still correct — if the account has not moved, this device's copy *is* the
 * merge — and if it has moved, the refusal is fine: the next open syncs.
 */
export function flushSync(): void {
  if (!store || !currentUser() || (timer === null && !heldBack)) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  heldBack = false;
  void pushIfUnmoved(store).catch(() => {});
}

/** Forget what this device last agreed with the account on. For sign-out. */
export function forgetSyncBase(): void {
  try {
    localStorage.removeItem(BASE_KEY);
  } catch {
    // Nothing to forget, or storage is blocked. Either way nothing is stale.
  }
}

/**
 * Start from scratch: this device, and the account when signed in.
 *
 * The account is not deleted — the same sign-in keeps working — but its copy
 * becomes a fresh, empty state, written like any other sync with the usual
 * version check. Other devices then lose the same plans and workouts on their
 * next sync, through the ordinary three-way merge: what they last agreed on
 * and have not changed since is gone from the account, so it goes from them
 * too. Anything they added in the meantime survives, as edits always do.
 *
 * Resolves once the device is reset. Throws only if the account could not be
 * written; the device is reset regardless, and the next sync carries the
 * reset up as deletions.
 */
export async function resetEverything(): Promise<void> {
  if (!store) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  heldBack = false;

  const fresh = defaultState();
  applying = true;
  try {
    store.replaceState(fresh);
  } finally {
    applying = false;
  }

  const user = currentUser();
  if (!user) return;

  for (let attempt = 1; ; attempt++) {
    const remote = await pullState();
    try {
      const updatedAt = await pushState(fresh, remote.updatedAt);
      writeBase(user.id, updatedAt, fresh);
      return;
    } catch (error) {
      if (error instanceof AccountError && error.status === 409 && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}

/* ------------------------------------------------------------------ steps */

async function run(appStore: AppStore, asked: boolean): Promise<void> {
  /*
   * Opening the app or coming back to it mid-workout syncs nothing. "Sync now"
   * does a full sync regardless — it used to only push, which on a device
   * never synced before did nothing at all while still reporting success —
   * but keeps this device's plan in force, so the week being trained does not
   * change mid-session.
   */
  const midWorkout = workoutOpen(appStore.getState());
  if (midWorkout && !asked) return;

  // A full sync carries anything held back during a workout.
  heldBack = false;

  for (let attempt = 1; ; attempt++) {
    const user = currentUser();
    if (!user) return;

    const local = appStore.getState();
    const remote = await pullState();

    const saved = readBase(user.id);
    let merged = local;
    let theirs: AppState | null = null;

    if (remote.state) {
      const parsed = parseState(remote.state);
      /*
       * A copy written by a newer version of the app would lose whatever that
       * version added if it were parsed down to this one and pushed back.
       * Refuse instead; the service worker update will arrive shortly.
       */
      const version = (remote.state as { schemaVersion?: unknown }).schemaVersion;
      if (!parsed.recognised || (typeof version === 'number' && version > CURRENT_SCHEMA_VERSION)) {
        throw new AccountError('The account was saved by a newer version. Reload to update the app.', 409);
      }
      // A base from before the account last changed is still the right base:
      // it is what this device last agreed on, and that is what the merge needs.
      theirs = parsed.state;
      merged = mergeStates(local, theirs, saved?.base ?? null);
    }

    /*
     * Mid-workout, this device keeps the plan it is training on — but only on
     * screen. The account still gets the merge's own choice, and the base
     * records this device's plan as what it last agreed to, so the next sync
     * after the workout sees an unchanged local choice and takes the other
     * device's. Pushing the held plan instead would overwrite a newer choice
     * made elsewhere and lose it for good.
     */
    const held = midWorkout ? local.activePlanId : undefined;
    const shown = held === undefined ? merged : holdPlan(merged, local);

    // Something was tapped while the pull was in flight. Start again from the
    // newer state rather than applying a merge built on the old one.
    if (appStore.getState() !== local) {
      if (attempt >= MAX_ATTEMPTS) return;
      continue;
    }

    if (shown !== local && !sameContent(shown, local)) {
      applying = true;
      try {
        appStore.replaceState(shown);
      } finally {
        applying = false;
      }
    }

    // What goes up: the merge, carrying the held plan's record if the other
    // copy had dropped it, so the week being trained is never deleted.
    const upload = held === undefined ? merged : { ...merged, plans: shown.plans };

    if (theirs && sameContent(upload, theirs)) {
      writeBase(user.id, remote.updatedAt, upload, held);
      return;
    }

    try {
      const updatedAt = await pushState(upload, remote.updatedAt);
      writeBase(user.id, updatedAt, upload, held);
      return;
    } catch (error) {
      // Another device wrote between the pull and the push. Pull its copy and
      // merge again — the whole point of the version check.
      if (error instanceof AccountError && error.status === 409 && attempt < MAX_ATTEMPTS) continue;
      throw error;
    }
  }
}

async function pushIfUnmoved(appStore: AppStore): Promise<void> {
  const user = currentUser();
  const saved = user ? readBase(user.id) : null;
  if (!user || !saved) return;

  const state = appStore.getState();
  const unchanged =
    saved.active === hash(state.active) && JSON.stringify(fingerprint(state)) === JSON.stringify(saved.base);
  if (unchanged) return;

  const updatedAt = await pushState(state, saved.updatedAt);
  writeBase(user.id, updatedAt, state);
}

/** Today's session is open. A stale one from an earlier day does not count. */
/**
 * How long an open session holds back sync. No workout runs this long; a
 * session still open past it was forgotten, and must not keep another
 * device's changes away for the rest of the day.
 */
const WORKOUT_HOLD_MS = 3 * 60 * 60 * 1000;

/** Today's session is open, and recent enough to be a real workout in progress. */
function workoutOpen(state: AppState): boolean {
  const active = state.active;
  if (active?.date !== todayIso() || !active) return false;
  // Sessions saved before `startedAt` was recorded carry zero; trust the date.
  return active.startedAt <= 0 || Date.now() - active.startedAt < WORKOUT_HOLD_MS;
}

/* ------------------------------------------------------------------- base */

function readBase(uid: string): StoredBase | null {
  try {
    const raw = localStorage.getItem(BASE_KEY);
    const stored = raw ? (JSON.parse(raw) as StoredBase) : null;
    // A base from another account says nothing about this one.
    return stored?.uid === uid && stored.base ? stored : null;
  } catch {
    return null;
  }
}

/** The merged state with this device's plan still in force, and still present. */
function holdPlan(merged: AppState, local: AppState): AppState {
  const own = local.plans.find((plan) => plan.id === local.activePlanId);
  const plans =
    own && !merged.plans.some((plan) => plan.id === own.id) ? [...merged.plans, own] : merged.plans;
  return { ...merged, plans, activePlanId: local.activePlanId };
}

/**
 * Record what this device and the account last agreed on.
 *
 * `heldPlan`, when given, is recorded as the agreed plan in force instead of
 * the one in `state` — see the mid-workout note in `run`.
 */
function writeBase(uid: string, updatedAt: number | null, state: AppState, heldPlan?: string | null): void {
  try {
    const base = fingerprint(state);
    const stored: StoredBase = {
      uid,
      updatedAt,
      base: heldPlan === undefined ? base : { ...base, activePlanId: hash(heldPlan) },
      active: hash(state.active),
    };
    localStorage.setItem(BASE_KEY, JSON.stringify(stored));
  } catch {
    // Without a base the next sync treats everything as new and unions it,
    // which loses nothing — it only means a deletion may come back once.
  }
}
