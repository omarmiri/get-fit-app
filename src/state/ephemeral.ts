/**
 * State that deliberately does not survive a reload.
 *
 * ## Why this module exists at all
 *
 * Everything else the app knows lives in `AppState` and is written to
 * localStorage. This is the exception, and the exception is the point: some
 * inputs should be *used* without being *kept*.
 *
 * Health context is the case that forced it. "High cholesterol", "recovering
 * from a hernia repair" — that shapes what a sensible training week looks
 * like, so a model writing one needs it. It does not follow that the app
 * should hold onto it. It was previously saved in `Preferences` so it would
 * not have to be retyped, which is a real convenience and the wrong trade: it
 * turned a sentence typed once into a medical detail sitting in browser
 * storage indefinitely, and later would have put it in a database under an
 * account.
 *
 * So it is typed, used for one generation, and gone when the tab closes. The
 * UI says so rather than leaving the user to discover it.
 *
 * ## What may live here
 *
 * Only things that are genuinely per-session inputs. This is not a scratchpad
 * for state someone could not be bothered to add to the schema — anything the
 * user would expect to still be there tomorrow belongs in `AppState`.
 */

interface EphemeralState {
  /**
   * Health context for the next plan generation, as typed.
   *
   * Sent to whichever model is writing the plan and included in the prompt the
   * user copies. Never written to storage, never persisted to an account.
   */
  conditions: string;
  /** Anything to work around this week, e.g. `sore left shoulder`. */
  notes: string;
}

const state: EphemeralState = {
  conditions: '',
  notes: '',
};

export function getConditionsText(): string {
  return state.conditions;
}

export function setConditionsText(value: string): void {
  state.conditions = value;
}

/** Health context as a list, which is what the prompt builders want. */
export function conditionsList(): readonly string[] {
  return state.conditions
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getNotes(): string {
  return state.notes;
}

export function setNotes(value: string): void {
  state.notes = value;
}

/** Clear everything. Used by tests; the tab closing does it in the app. */
export function resetEphemeral(): void {
  state.conditions = '';
  state.notes = '';
}
