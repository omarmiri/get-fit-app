import type { Exercise, UserPlan } from '@/types';
import { ALL_EXERCISES, getBuiltinExercise } from './exercises';

/**
 * Resolving an exercise id against the built-in catalogue *and* whatever the
 * active plan defined for itself.
 *
 * ## Why the plan is passed in rather than registered
 *
 * A module-level registry that the store updated on every plan change would be
 * less typing at every call site and would be the wrong shape: the app's one
 * piece of mutable state is `AppState`, held by the store, and everything else
 * derives from it. A second source of truth that has to be kept in sync with
 * the first is exactly the bug this codebase has otherwise avoided.
 *
 * So resolution takes the plan explicitly. Call sites that have it get custom
 * movements; call sites that do not get the built-in catalogue, which is the
 * correct answer for them.
 *
 * ## Orphans are expected, not exceptional
 *
 * Logged sets reference exercise ids forever, and a custom movement lives only
 * as long as the plan that defined it. Replace the plan and last month's
 * `x:bulgarian-split-squat` sets reference a movement nothing can resolve.
 *
 * That is not corruption — the sets themselves are intact, and history renders
 * them by id. It is the same situation as an exercise retired from the
 * built-in catalogue, which the app has always had to handle. Callers must
 * treat `undefined` as normal.
 */

/** Resolve an exercise id, preferring the plan's own definitions. */
export function resolveExercise(id: string, plan: UserPlan | null): Exercise | undefined {
  const custom = plan?.exercises?.find((exercise) => exercise.id === id);
  if (custom) return custom;
  return getBuiltinExercise(id);
}

/**
 * Every exercise available under a given plan: the built-in catalogue plus the
 * plan's own, built-ins first so the stable ones lead any picker.
 */
export function catalogueFor(plan: UserPlan | null): readonly Exercise[] {
  const custom = plan?.exercises ?? [];
  return custom.length === 0 ? ALL_EXERCISES : [...ALL_EXERCISES, ...custom];
}
