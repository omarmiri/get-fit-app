/**
 * Input bounds.
 *
 * The steppers accept free text, and a phone keyboard in a gym produces typos.
 * These clamps keep a stray keystroke from poisoning the history and the charts
 * — a mistyped `5000` would flatten every trend line permanently.
 */

export const LIMITS = {
  /** Upper bound is generous enough for a loaded leg press in pounds. */
  weight: { min: 0, max: 2000 },
  /** Also used for seconds on timed holds and carries. */
  reps: { min: 0, max: 999 },
  /** A single session longer than 8 hours is a typo, not a workout. */
  minutes: { min: 0, max: 480 },
  /** Rest timer additions, to stop the stack from being pushed off-scale. */
  restSeconds: { min: 0, max: 3600 },
} as const;

/** Coerce unknown input to a finite number within `[min, max]`, or `fallback`. */
export function clampNumber(
  value: unknown,
  { min, max }: { readonly min: number; readonly max: number },
  fallback = min,
): number {
  const raw = typeof value === 'string' ? value : '';
  const parsed = typeof value === 'number' ? value : Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Clamp a weight entry. Fractional values survive — 2.5 kg plates are real. */
export function clampWeight(value: unknown): number {
  return Math.round(clampNumber(value, LIMITS.weight) * 100) / 100;
}

/** Clamp a rep or seconds entry to a whole number. */
export function clampReps(value: unknown): number {
  return Math.round(clampNumber(value, LIMITS.reps));
}

/** Clamp a session duration to a whole number of minutes. */
export function clampMinutes(value: unknown): number {
  return Math.round(clampNumber(value, LIMITS.minutes));
}

/** Clamp a rest-timer duration to a whole number of seconds. */
export function clampRestSeconds(value: unknown): number {
  return Math.round(clampNumber(value, LIMITS.restSeconds));
}
