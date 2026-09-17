// Relative rather than `@/`, like `planFormat.ts` — this module is reachable
// from the build-time spec generator, outside Vite's alias resolution.
import { getStation } from '../data/equipment';

/**
 * A training week small enough to travel inside a link.
 *
 * ## The problem
 *
 * A plan in this app's JSON format runs to six or twelve kilobytes, which is
 * past what a chat window will render as a clickable link and past what any
 * browsing tool will fetch. So the plan came back by copy and paste: the model
 * printed JSON, the user tapped the code block's copy button, switched apps,
 * and pasted. Four actions, and the two in the middle are the ones people get
 * wrong or give up on.
 *
 * This format exists to make one action enough. The same week written compactly
 * is about a kilobyte, which fits in a URL fragment with room to spare — so the
 * model can end its reply with **Open in Rack & File**, and the user taps it.
 *
 * ## Why a fragment and not a query string
 *
 * A fragment is never sent to the server. It does not reach the access log, it
 * does not reach CloudFront, and it cannot leak through a `Referer` header. The
 * plan stays between the user's chat window and the user's browser, which is
 * the same promise the rest of this app makes about the survey.
 *
 * ## Why this shape
 *
 * Written to be typed correctly by a language model on the first attempt, which
 * ruled out most of the obvious encodings. Base64 and gzip are out — a model
 * cannot do either by hand, and a code tool is not available in half the
 * products people use. A purely positional CSV is out too: one field in the
 * wrong slot silently shifts a whole day, and the failure is invisible.
 *
 * So: two positional fields, which are short and hard to confuse, then keyed
 * ones. A key a model omits is a default; a key it invents is ignored; a key
 * out of order is fine. The only real rule is that a tilde separates records
 * and a pipe separates fields, so neither may appear inside a value.
 *
 * ## What it deliberately cannot carry
 *
 * Cues, tips, muscles, alternatives — the prose that makes a *defined* movement
 * usable. Those are most of the bytes, and dropping them is what makes the link
 * possible. Built-in movements carry their own, so a plan written from the
 * catalogue loses nothing; a plan inventing movements is better sent as JSON,
 * and `/llms.txt` says so.
 */

/** Record separator. A tilde survives a URL unescaped in every browser tested. */
const RECORD = /[~\n]/;

const FIELD = '|';

/** Outline steps, inside one field. */
const STEP = ';';

const TYPES: Record<string, string> = {
  str: 'strength',
  dur: 'duration',
  int: 'intervals',
  mix: 'mixed',
  rest: 'rest',
  strength: 'strength',
  duration: 'duration',
  intervals: 'intervals',
  mixed: 'mixed',
};

/** Types whose minutes are cardiovascular unless the author says otherwise. */
const AEROBIC_TYPES = new Set(['duration', 'intervals', 'mixed']);

const DAY_KEYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

/** Whether text claims to be a compact plan, cheaply enough to test anything. */
export function looksCompact(text: string): boolean {
  return /^\s*rf1\s*[~\n|]/i.test(text);
}

/**
 * Expand compact text into the ordinary plan object.
 *
 * Returns `null` when the text is not this format at all. Everything after
 * that is best effort: a record this cannot read is skipped rather than fatal,
 * and `parsePortablePlan` — which validates the result like any other plan —
 * is left to decide whether what survived is still a week.
 *
 * That division matters. This function's job is transcription, not judgement;
 * there is exactly one place in the app that decides whether a plan is
 * acceptable, and it is not here.
 */
export function expandCompactPlan(input: string): Record<string, unknown> | null {
  const text = decodeIfEncoded(input).trim();
  if (!looksCompact(text)) return null;

  // Newlines are accepted alongside the tilde so that a compact plan which
  // arrives pasted, rather than through a link, reads the same way.
  const records = text
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean);

  // The marker itself, and the summary that may follow it on the same record.
  const head = records.shift() ?? '';
  const summary = head.includes(FIELD) ? head.slice(head.indexOf(FIELD) + 1).trim() : '';

  const days: Record<string, unknown>[] = [];
  const exercises: Record<string, unknown>[] = [];
  let author = 'imported';

  for (const record of records) {
    const parts = record.split(FIELD).map((part) => part.trim());
    const kind = (parts[0] ?? '').toLowerCase();

    if (kind === 'x') {
      const exercise = readExercise(parts);
      if (exercise) exercises.push(exercise);
      continue;
    }

    if (kind === 'by') {
      // An empty value keeps the default rather than blanking the author.
      if (parts[1]) author = parts[1];
      continue;
    }

    const day = readDay(parts);
    if (day) days.push(day);
  }

  return {
    kind: 'rackfile.plan',
    formatVersion: 1,
    author,
    summary,
    ...(exercises.length > 0 ? { exercises } : {}),
    days,
  };
}

/* ------------------------------------------------------------------ parts */

/**
 * `key=value` pairs from the tail of a record.
 *
 * A field with no `=` is not an error — models occasionally drop the key on
 * the label, which is the most common field — so the first such field becomes
 * the label and the rest are ignored. Guessing once, on the field that is
 * unambiguous, is worth more than a correct refusal.
 */
function readKeys(parts: readonly string[]): Map<string, string> {
  const keys = new Map<string, string>();

  for (const part of parts) {
    const at = part.indexOf('=');
    if (at > 0) {
      const key = part.slice(0, at).trim().toLowerCase();
      if (!keys.has(key)) keys.set(key, part.slice(at + 1).trim());
    } else if (part && !keys.has('l')) {
      keys.set('l', part);
    }
  }

  return keys;
}

function readDay(parts: readonly string[]): Record<string, unknown> | null {
  const dayKey = (parts[0] ?? '').toLowerCase();
  if (!DAY_KEYS.has(dayKey)) return null;

  const type = TYPES[(parts[1] ?? '').toLowerCase()] ?? 'rest';
  const keys = readKeys(parts.slice(2));

  const outline = (keys.get('o') ?? '')
    .split(STEP)
    .map((step) => step.trim())
    .filter(Boolean);

  const exerciseIds = (keys.get('e') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const minutes = Number.parseInt(keys.get('m') ?? '', 10);

  /*
   * `d` is whatever the cardio is done on. It may be one of this app's station
   * ids, which lights up the "that machine is busy" swap sheet, or it may be
   * plain English, which always works. Deciding here rather than sending both
   * keeps the day from displaying the same word twice.
   */
  const modality = keys.get('d') ?? '';
  const station = modality ? getStation(modality.toLowerCase()) : undefined;
  const note = keys.get('n');

  return {
    dayKey,
    type,
    label: keys.get('l') ?? '',
    aerobic: keys.get('a') === '0' ? false : AEROBIC_TYPES.has(type),
    outline,
    ...(Number.isFinite(minutes) ? { minutes } : {}),
    ...(exerciseIds.length > 0 ? { exerciseIds } : {}),
    ...(modality ? (station ? { modalityStations: [station.id] } : { modality }) : {}),
    ...(note ? { note } : {}),
  };
}

function readExercise(parts: readonly string[]): Record<string, unknown> | null {
  const name = parts[1] ?? '';
  if (!name) return null;

  const keys = readKeys(parts.slice(2));
  const summary = keys.get('d');
  const equipment = keys.get('q');
  const reps = readReps(keys.get('r') ?? '');
  const weight = readWeight(keys.get('w') ?? '');
  const sets = Number.parseInt(keys.get('s') ?? '', 10);

  return {
    name,
    ...(summary ? { summary } : {}),
    ...(equipment ? { equipment } : {}),
    ...(Number.isFinite(sets) ? { sets } : {}),
    ...reps,
    /*
     * An opening weight is the only signal in this format that a movement is
     * loaded at all. That is not a shortcut — a loaded movement without one
     * gets a crude bodyweight-ratio guess, so an author who omits it is
     * already better served by the bodyweight path, and one who supplies it
     * has said everything the app needs.
     */
    ...(weight ? { loaded: true, openingWeight: weight } : { loaded: false }),
  };
}

/** `8-12`, `8`, or `20-45s` for a hold measured in seconds. */
function readReps(raw: string): Record<string, unknown> {
  if (!raw) return {};

  const seconds = /s$/i.test(raw);
  const [min, max] = raw
    .replace(/s$/i, '')
    .split(/[-–]/)
    .map((part) => Number.parseInt(part.trim(), 10));

  if (min === undefined || !Number.isFinite(min)) return {};

  return {
    repMin: min,
    repMax: max !== undefined && Number.isFinite(max) ? max : min,
    ...(seconds ? { repMetric: 'seconds' } : {}),
  };
}

/** `45lb`, `20kg`, or a bare number taken as pounds. */
function readWeight(raw: string): { value: number; unit: 'lb' | 'kg' } | null {
  const match = /^(\d+(?:\.\d+)?)\s*(lb|kg)?$/i.exec(raw.trim());
  if (!match?.[1]) return null;

  return {
    value: Number.parseFloat(match[1]),
    unit: match[2]?.toLowerCase() === 'kg' ? 'kg' : 'lb',
  };
}

/**
 * Undo percent-encoding when the text still carries it.
 *
 * The app decodes the fragment itself, so this is for the other ways compact
 * text arrives — pasted out of a chat window with the escapes still in it, or
 * double-encoded by a model being careful. Decoding text that was never
 * encoded is harmless; failing to decode text that was is a plan full of
 * `%20`.
 */
function decodeIfEncoded(text: string): string {
  if (!/%[0-9a-f]{2}/i.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
