import type { Exercise, StationOption } from '@/types';

/**
 * A compact way to write a catalogue entry.
 *
 * The original seventeen movements in `exercises.ts` spell every field out.
 * At a hundred that stops being careful and starts being copy-paste, and the
 * fields that are easiest to get wrong by hand are the ones derivable from
 * others: the display range from the numbers, the default from the range, and
 * whether a hold says "sec". Deriving them here means they cannot disagree.
 *
 * Everything else is still written out per movement, on purpose. Cues, the
 * station list and the opening factor are judgement, not arithmetic.
 */
export interface MoveSpec {
  readonly id: string;
  readonly name: string;
  /** One plain sentence saying what the movement physically is. */
  readonly summary: string;
  readonly alternative?: string;
  readonly sets: number;
  /** `[min, max]` — reps, or seconds when `timed`. */
  readonly reps: readonly [number, number];
  readonly timed?: boolean;
  readonly loaded: boolean;
  readonly inverseLoad?: boolean;
  readonly rest: number;
  readonly muscles: readonly string[];
  /** Best first. The head is the reference the others' load factors scale from. */
  readonly stations?: readonly StationOption[];
  /**
   * Novice opening load on the primary station, as a fraction of bodyweight —
   * per hand when the primary is. Timid by design: see `domain/startingWeights.ts`.
   */
  readonly opening?: number;
  /** Setup, execution, and the single most common way it goes wrong. */
  readonly cues: readonly [string, string, string];
  readonly tips?: readonly string[];
}

export function move(spec: MoveSpec): Exercise {
  const [repMin, repMax] = spec.reps;
  const range = repMin === repMax ? `${repMin}` : `${repMin}–${repMax}`;
  const [setup, execute, avoid] = spec.cues;

  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    ...(spec.alternative ? { alternative: spec.alternative } : {}),
    sets: spec.sets,
    repRange: spec.timed ? `${range} sec` : range,
    repMin,
    repMax,
    defaultReps: Math.round((repMin + repMax) / 2),
    repMetric: spec.timed ? 'seconds' : 'reps',
    loaded: spec.loaded,
    ...(spec.inverseLoad ? { inverseLoad: true } : {}),
    restSeconds: spec.rest,
    muscles: spec.muscles,
    ...(spec.stations ? { stations: spec.stations } : {}),
    ...(spec.opening === undefined ? {} : { bodyweightFactor: spec.opening }),
    cues: { setup, execute, avoid },
    ...(spec.tips ? { tips: spec.tips } : {}),
  };
}
