import type { AppState, Exercise, Session, UserPlan } from '@/types';

/**
 * Merging two devices' copies of the app state.
 *
 * ## Why three-way
 *
 * Comparing only "here" and "the account" cannot tell a plan deleted on this
 * phone from a plan added on the PC: both look like one copy has it and the
 * other does not. The third input is what this device last agreed with the
 * account on — its *base* — and against that the two cases come apart: a
 * record the base had and this copy lacks was deleted here; one the base never
 * saw was added there.
 *
 * The base is kept as fingerprints rather than a second copy of the state. A
 * long training history is megabytes, localStorage is about five, and all a
 * merge ever asks of the base is "did this record change since" — which a hash
 * answers exactly as well.
 *
 * ## The rules, per record
 *
 * Sessions, plans, archived movements and the user's own movements are merged
 * by id; preferences key by key; the plan in force as one value. For each:
 *
 * - Changed on one side only: that side wins, including a deletion.
 * - Deleted on one side, edited on the other: the edit wins. Losing a change
 *   is worse than resurrecting a deleted record, which can be deleted again.
 * - Changed on both, or no base to judge by: see `Conflict` below.
 *
 * The in-progress workout is never merged. It belongs to the device it is
 * being logged on, and nothing arriving from another device may change it.
 */

/** What this device last agreed with the account on, as fingerprints. */
export interface SyncBase {
  readonly sessions: Readonly<Record<string, string>>;
  readonly plans: Readonly<Record<string, string>>;
  readonly archive: Readonly<Record<string, string>>;
  /** Optional: a base saved before the library existed has none. */
  readonly library?: Readonly<Record<string, string>>;
  readonly prefs: Readonly<Record<string, string>>;
  readonly activePlanId: string;
}

export function fingerprint(state: AppState): SyncBase {
  return {
    sessions: byId(state.sessions),
    plans: byId(state.plans),
    archive: byId(state.exerciseArchive),
    library: byId(state.customExercises),
    prefs: Object.fromEntries(Object.entries(state.prefs).map(([key, value]) => [key, hash(value)])),
    activePlanId: hash(state.activePlanId),
  };
}

/** True when two states would merge to either one — nothing to exchange. */
export function sameContent(a: AppState, b: AppState): boolean {
  return hash(withoutActive(a)) === hash(withoutActive(b));
}

/**
 * How a record changed on both sides, or with no base, is settled.
 *
 * With no base — the first sync on this device — the account wins wherever
 * both sides have a value, because a fresh device's defaults are not choices
 * anyone made. Records are still unioned, so a history logged here before
 * signing in is kept rather than replaced.
 *
 * With a base, a genuine conflict is rare: the same plan renamed on two
 * devices between syncs. This device wins, as the one the user is holding.
 * Sessions are the exception and go to whichever copy was finished later,
 * since a reopened and re-finished session is the more complete one.
 */
export function mergeStates(local: AppState, remote: AppState, base: SyncBase | null): AppState {
  const preferRemote = base === null;

  const sessions = mergeRecords(local.sessions, remote.sessions, base?.sessions, (l, r) =>
    finishedAt(r) > finishedAt(l) ? r : l,
  );
  const plans = mergeRecords(local.plans, remote.plans, base?.plans, (l, r) => (preferRemote ? r : l));
  const exerciseArchive = mergeRecords(
    local.exerciseArchive,
    remote.exerciseArchive,
    base?.archive,
    (l) => l,
  );
  const customExercises = mergeRecords(
    local.customExercises,
    remote.customExercises,
    base?.library,
    (l, r) => (preferRemote ? r : l),
  );

  const mine: Readonly<Record<string, unknown>> = { ...local.prefs };
  const theirs: Readonly<Record<string, unknown>> = { ...remote.prefs };
  const prefs: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const value = mergeValue(
      mine[key],
      theirs[key],
      base === null ? undefined : (base.prefs[key] ?? hash(undefined)),
      preferRemote,
    );
    if (value !== undefined) prefs[key] = value;
  }

  const chosen = mergeValue(local.activePlanId, remote.activePlanId, base?.activePlanId, preferRemote);
  // A plan in force that the merge removed falls back to the built-in week,
  // the same as deleting it on this device would.
  const activePlanId = typeof chosen === 'string' && plans.some((plan) => plan.id === chosen) ? chosen : null;

  return {
    ...local,
    sessions: sortSessions(sessions),
    plans: [...plans].sort((a, b) => a.generatedAt - b.generatedAt || a.id.localeCompare(b.id)),
    exerciseArchive,
    customExercises,
    prefs: prefs as unknown as AppState['prefs'],
    activePlanId,
    // Never merged: see the module note.
    active: local.active,
  };
}

/* ---------------------------------------------------------------- records */

function mergeRecords<T extends Session | UserPlan | Exercise>(
  local: readonly T[],
  remote: readonly T[],
  base: Readonly<Record<string, string>> | undefined,
  conflict: (local: T, remote: T) => T,
): T[] {
  const theirs = new Map(remote.map((record) => [record.id, record]));
  const merged: T[] = [];

  for (const mine of local) {
    const other = theirs.get(mine.id);
    theirs.delete(mine.id);
    const was = base?.[mine.id];

    if (!other) {
      // Absent there. Deleted there if this copy is what the base recorded;
      // otherwise added or edited here, and kept.
      if (was === undefined || hash(mine) !== was) merged.push(mine);
      continue;
    }

    const mineHash = hash(mine);
    const otherHash = hash(other);
    if (mineHash === otherHash || otherHash === was) merged.push(mine);
    else if (mineHash === was) merged.push(other);
    else merged.push(conflict(mine, other));
  }

  // Only there. Deleted here if it is unchanged from the base; added or
  // edited there otherwise.
  for (const other of theirs.values()) {
    const was = base?.[other.id];
    if (was === undefined || hash(other) !== was) merged.push(other);
  }

  return merged;
}

function mergeValue(
  local: unknown,
  remote: unknown,
  was: string | undefined,
  preferRemote: boolean,
): unknown {
  const mine = hash(local);
  const other = hash(remote);
  if (mine === other || other === was) return local;
  if (mine === was) return remote;
  // With no base, an absent value on the account is not a decision to clear
  // this device's — it is only a setting nobody made there yet.
  return preferRemote ? (remote ?? local) : local;
}

/* ---------------------------------------------------------------- helpers */

function finishedAt(session: Session): number {
  return session.finishedAt ?? session.startedAt;
}

function sortSessions(sessions: Session[]): Session[] {
  return sessions.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
}

function withoutActive(state: AppState): unknown {
  const { active: _active, schemaVersion: _version, ...rest } = state;
  return rest;
}

function byId(records: readonly { readonly id: string }[]): Record<string, string> {
  return Object.fromEntries(records.map((record) => [record.id, hash(record)]));
}

/**
 * A short fingerprint of any JSON value, independent of key order.
 *
 * Key order matters because the same record can be rebuilt with its fields in
 * a different order — renaming a plan removes `name` and adds it back — and
 * that is not a change. cyrb53: not cryptographic, and does not need to be;
 * the only question it answers is whether this device's own record changed.
 */
export function hash(value: unknown): string {
  const text = stable(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function stable(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
