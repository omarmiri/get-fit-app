import type { PlanRequest, UserPlan } from '@/types';
import { ALL_EXERCISES } from '@/data/exercises';
import { ALL_STATIONS } from '@/data/equipment';
import { GOALS } from '@/data/plan';
import { parsePortablePlan } from '@/domain/planFormat';

/**
 * Client side of in-app plan generation.
 *
 * Talks only to this app's own origin. The Gemini key lives on the server, so
 * nothing here knows or can leak it.
 *
 * The response goes through `parsePortablePlan`, the same parser that reads a
 * file someone pasted in from another chatbot. That is deliberate: the in-app
 * generator gets no privileged path and no relaxed validation. If the format
 * is good enough to trust from a stranger's LLM, it is good enough here, and
 * if it has a hole, it has that hole in one place where a test can find it.
 */

export class PlanApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlanApiError';
    this.status = status;
  }
}

/** Whether the server has a Gemini key, so the UI can hide a doomed button. */
export async function isPlanGenerationAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && (body as { gemini?: boolean }).gemini === true;
  } catch {
    return false;
  }
}

export async function requestPlan(request: PlanRequest): Promise<UserPlan> {
  let response: Response;
  try {
    response = await fetch('/api/plan/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(request.profile ? { profile: request.profile } : {}),
        conditions: request.conditions,
        notes: request.notes,
        goals: GOALS,
        ...(request.gym ? { gym: request.gym } : {}),
        /*
         * The catalogues travel with the request rather than being duplicated
         * server-side: one source of truth for what the app already knows, at
         * the cost of a larger body. A server-side copy would drift the first
         * time the catalogue changed.
         *
         * These are a starting vocabulary, not a fence. The model may define
         * movements of its own, exactly as an external LLM would — the user's
         * own description of their gym is the better guide to what they can
         * actually reach.
         */
        exercises: ALL_EXERCISES.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          muscles: exercise.muscles ?? [],
        })),
        stations: ALL_STATIONS.filter((station) => request.availableStationIds.includes(station.id)).map(
          (station) => ({ id: station.id, name: station.name, zone: station.zone }),
        ),
      }),
    });
  } catch {
    throw new PlanApiError('Could not reach the server. Check your connection.', 0);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Plan generation failed (${response.status}).`;
    throw new PlanApiError(message, response.status);
  }

  const raw = (body as { plan?: unknown } | null)?.plan;
  const model = (body as { model?: unknown } | null)?.model;

  const parsed = parsePortablePlan(raw);
  if (!parsed.plan) {
    throw new PlanApiError(parsed.error ?? 'The server returned a plan in an unexpected shape.', 502);
  }

  // The server knows which model actually answered; the plan body does not.
  return typeof model === 'string' && model ? { ...parsed.plan, model } : parsed.plan;
}
