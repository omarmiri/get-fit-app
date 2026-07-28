import type { GeneratedDay, GeneratedPlan, PlanRequest } from '@/types';
import { ALL_EXERCISES } from '@/data/exercises';
import { ALL_STATIONS } from '@/data/equipment';
import { GOALS } from '@/data/plan';

/**
 * Client side of plan generation.
 *
 * Talks only to this app's own origin. The Gemini key lives on the server, so
 * nothing here knows or can leak it.
 *
 * The catalogues travel with the request rather than being duplicated in
 * `server.js`. One source of truth for what exercises and stations exist, at
 * the cost of a slightly larger request body — worth it, because a server-side
 * copy would drift the first time the catalogue changed.
 */

export interface PlanApiResult {
  readonly plan: GeneratedPlan;
}

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

export async function requestPlan(request: PlanRequest): Promise<GeneratedPlan> {
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
        // Only movements and equipment actually usable, so the model cannot
        // prescribe a machine the club does not have.
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

  const raw = (body as { plan?: unknown; model?: unknown } | null)?.plan;
  const model = (body as { model?: unknown } | null)?.model;

  const parsed = toGeneratedPlan(raw, typeof model === 'string' ? model : 'unknown');
  if (!parsed) throw new PlanApiError('The server returned a plan in an unexpected shape.', 502);

  return parsed;
}

/**
 * Coerce the model's JSON into `GeneratedPlan`.
 *
 * Shape only — whether the plan is *sensible* is decided by
 * `domain/planValidation.ts` against the real catalogue. This layer just makes
 * sure the fields are the types they claim to be, so nothing downstream has to
 * defend against a string where a number belongs.
 */
function toGeneratedPlan(raw: unknown, model: string): GeneratedPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  if (!Array.isArray(record['days'])) return null;

  const days = record['days'].map(toGeneratedDay).filter((day): day is GeneratedDay => day !== null);

  if (days.length === 0) return null;

  return {
    id: `plan-${Date.now().toString(36)}`,
    summary: typeof record['summary'] === 'string' ? record['summary'] : '',
    days,
    generatedAt: Date.now(),
    model,
  };
}

function toGeneratedDay(raw: unknown): GeneratedDay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const dayKey = record['dayKey'];
  if (typeof dayKey !== 'string') return null;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const minutes = record['minutes'];
  const format = record['exerciseFormat'];
  const rounds = record['rounds'];

  return {
    dayKey: dayKey as GeneratedDay['dayKey'],
    label: typeof record['label'] === 'string' ? record['label'] : '',
    type: (typeof record['type'] === 'string' ? record['type'] : 'rest') as GeneratedDay['type'],
    sub: typeof record['sub'] === 'string' ? record['sub'] : '',
    note: typeof record['note'] === 'string' ? record['note'] : '',
    outline: strings(record['outline']),
    aerobic: record['aerobic'] === true,
    ...(typeof minutes === 'number' && Number.isFinite(minutes) ? { minutes: Math.round(minutes) } : {}),
    ...(strings(record['modalityStations']).length > 0
      ? { modalityStations: strings(record['modalityStations']) }
      : {}),
    ...(strings(record['exerciseIds']).length > 0 ? { exerciseIds: strings(record['exerciseIds']) } : {}),
    ...(format === 'circuit' || format === 'sets' ? { exerciseFormat: format } : {}),
    ...(typeof rounds === 'string' && rounds.length > 0 ? { rounds } : {}),
  };
}
