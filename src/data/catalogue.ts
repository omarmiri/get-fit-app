import type { AppState, Exercise, UserPlan } from '@/types';
import { ALL_EXERCISES, getBuiltinExercise } from './exercises';

/**
 * Resolving an exercise id against everything that can define one: the
 * built-in catalogue, the active plan, and the archive of movements already
 * logged against.
 *
 * ## Why the sources are passed in rather than registered
 *
 * A module-level registry that the store updated on every change would be less
 * typing at every call site and would be the wrong shape: the app's one piece
 * of mutable state is `AppState`, held by the store, and everything else
 * derives from it. A second source of truth that has to be kept in sync with
 * the first is exactly the bug this codebase has otherwise avoided.
 *
 * A caller holding state passes `exerciseSourceOf(state)`. A caller holding
 * only a plan — validation, for instance, which runs before a plan is adopted
 * — passes `{ plan }`.
 *
 * ## Precedence, and why
 *
 * Plan, then archive, then built-in.
 *
 * Built-in ids cannot collide with the other two, which are namespaced under
 * `x:`. Plan and archive genuinely can: a movement is archived when first
 * logged, and the plan that defines it may since have been regenerated with a
 * revised version of the same id. The plan wins, because it describes what the
 * user is being asked to do *now*; the archive exists to explain what they
 * did *then*, and is consulted only when nothing current can.
 */

export interface ExerciseSource {
  /** The plan in force, if any. */
  readonly plan?: UserPlan | null;
  /** Definitions retained for movements already logged against. */
  readonly exerciseArchive?: readonly Exercise[];
}

/**
 * The plan in force, or `null` for the built-in rotation.
 *
 * An `activePlanId` that no longer resolves — a plan deleted while selected,
 * or an id from a restored backup whose plan did not come with it — falls back
 * to the built-in rotation rather than erroring. There is always a week.
 */
export function activePlan(state: Pick<AppState, 'plans' | 'activePlanId'>): UserPlan | null {
  if (!state.activePlanId) return null;
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? null;
}

/** Everything needed to resolve an exercise id, derived from state. */
export function exerciseSourceOf(state: AppState): ExerciseSource {
  return { plan: activePlan(state), exerciseArchive: state.exerciseArchive };
}

/**
 * Resolve an exercise id.
 *
 * Returns `undefined` for an id nothing can define. That remains possible —
 * an exercise retired from the built-in catalogue, or a custom movement whose
 * plan was replaced before anything was ever logged against it — so callers
 * must treat it as normal rather than exceptional.
 */
export function resolveExercise(id: string, source: ExerciseSource): Exercise | undefined {
  const fromPlan = source.plan?.exercises?.find((exercise) => exercise.id === id);
  if (fromPlan) return fromPlan;

  const archived = source.exerciseArchive?.find((exercise) => exercise.id === id);
  if (archived) return archived;

  return getBuiltinExercise(id);
}

/**
 * Every exercise a given state can describe: built-ins, the plan's own, and
 * anything archived that the plan no longer defines.
 *
 * Built-ins lead, so the stable movements come first in any picker. Ordering
 * within the custom entries follows the plan, then the archive.
 */
export function catalogueFor(source: ExerciseSource): readonly Exercise[] {
  const fromPlan = source.plan?.exercises ?? [];
  const archived = source.exerciseArchive ?? [];

  if (fromPlan.length === 0 && archived.length === 0) return ALL_EXERCISES;

  const seen = new Set(fromPlan.map((exercise) => exercise.id));
  const extra = [...fromPlan, ...archived.filter((exercise) => !seen.has(exercise.id))];

  return [...ALL_EXERCISES, ...extra];
}
