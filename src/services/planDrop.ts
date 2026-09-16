import type { UserPlan } from '@/types';

/**
 * Client side of plan drops.
 *
 * The app opens a session, shows the user a push id to carry into their LLM,
 * and then watches for a plan to arrive. Everything here talks only to this
 * app's own origin.
 *
 * ## What is kept on the device, and why
 *
 * The poll token. It is the half of the session that grants reading, and it
 * must never appear in anything a model sees — see the note on the two ids in
 * `sessions.js`. Keeping it in `localStorage` rather than memory means closing
 * the tab and coming back later still finds the plan, which is the normal case
 * rather than the exception: people go and have the conversation, and return.
 *
 * ## Why this polls rather than streams
 *
 * A server-sent stream would be tidier and is the wrong shape for where this
 * runs. The server is a Lambda behind CloudFront; holding a connection open
 * for the minutes a user spends in a chat window means paying for an idle
 * invocation the whole time. Polling a few times a minute while a screen is
 * actually open costs a rounding error and survives the phone sleeping,
 * backgrounding the tab, or losing signal on the way out of the gym.
 */

const SESSION_KEY = 'rackfile.drop';

/** What the device keeps so it can read its own session back. */
interface StoredDrop {
  readonly pushId: string;
  readonly pollToken: string;
  readonly expiresAt: number;
}

/** One plan pushed to the session, as the app sees it. */
export interface DroppedPlan {
  readonly version: number;
  readonly receivedAt: number;
  readonly plan: UserPlan;
}

let cached: StoredDrop | null | undefined;

function read(): StoredDrop | null {
  if (cached !== undefined) return cached;

  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;

    cached =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredDrop).pushId === 'string' &&
      typeof (parsed as StoredDrop).pollToken === 'string' &&
      typeof (parsed as StoredDrop).expiresAt === 'number'
        ? (parsed as StoredDrop)
        : null;
  } catch {
    // A corrupt record costs one new session, which is not worth a failure.
    cached = null;
  }
  return cached;
}

function write(drop: StoredDrop | null): void {
  cached = drop;
  try {
    if (drop) localStorage.setItem(SESSION_KEY, JSON.stringify(drop));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked or full. The session still works for this tab.
  }
}

/**
 * The live session, or `null`.
 *
 * Expiry is checked here rather than trusted from the server, so a stale id is
 * never shown to a user who would then paste it into a chat and be told, some
 * minutes later, that it is not open.
 */
export function currentDrop(): { pushId: string; expiresAt: number } | null {
  const drop = read();
  if (!drop) return null;

  if (drop.expiresAt <= Date.now()) {
    write(null);
    return null;
  }

  return { pushId: drop.pushId, expiresAt: drop.expiresAt };
}

/** Throw the current session away, so the next prompt carries a fresh id. */
export function clearDrop(): void {
  write(null);
}

/**
 * Open a session, reusing the live one if there is one.
 *
 * Reuse matters for the revision loop: "make Thursday easier" is a follow-up
 * in the same chat, and that chat already has an id in its history. Minting a
 * new one per prompt would silently invalidate the id the model is still
 * holding.
 */
export async function openDrop(): Promise<{ pushId: string; expiresAt: number }> {
  const existing = currentDrop();
  if (existing) return existing;

  const response = await fetch('/api/sessions', { method: 'POST' });
  if (!response.ok) throw new Error(`Could not open a session (${response.status}).`);

  const body = (await response.json()) as StoredDrop;
  if (!body?.pushId || !body?.pollToken) throw new Error('The server did not return a session.');

  write(body);
  return { pushId: body.pushId, expiresAt: body.expiresAt };
}

/** Where a model should POST. Absolute, because the model is not on this origin. */
export function dropEndpoint(pushId: string): string {
  return `${location.origin}/api/sessions/${pushId}/plans`;
}

/**
 * Plans pushed to the current session.
 *
 * Returns an empty list when there is no session, rather than throwing: "no
 * session" and "a session with nothing in it yet" look the same to the screen
 * that displays this, and both mean keep waiting.
 */
export async function pollDrop(): Promise<readonly DroppedPlan[]> {
  const drop = read();
  if (!drop || drop.expiresAt <= Date.now()) return [];

  const response = await fetch(`/api/sessions/${drop.pushId}`, {
    headers: { authorization: `Bearer ${drop.pollToken}` },
    cache: 'no-store',
  });

  if (response.status === 404) {
    // The server no longer has it — expired, or evicted. Stop showing an id
    // that cannot receive anything.
    write(null);
    return [];
  }
  if (!response.ok) throw new Error(`Could not check for a plan (${response.status}).`);

  const body = (await response.json()) as { plans?: readonly DroppedPlan[] };
  return body.plans ?? [];
}
