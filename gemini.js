/**
 * Gemini plan generation, server side.
 *
 * The API key lives in this process and never reaches the browser. That is a
 * cost-control measure as much as anything: a key shipped to the client is a
 * key someone else spends.
 *
 * The model's job is deliberately narrow. It selects movements and arranges a
 * week *by referencing catalogue ids the client supplies* — it never invents an
 * exercise, never names a machine freehand, and never prescribes a load. Loads
 * come from the app's own progression arithmetic, which is deterministic and
 * testable. A response schema enforces the shape; the client then validates the
 * content against the real catalogue before anything is saved.
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Overridable so a new model can be tried without a code change. */
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/** Generation is slow enough to need a real ceiling, short enough to not hang. */
const REQUEST_TIMEOUT_MS = 45_000;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SESSION_TYPES = ['strength', 'duration', 'intervals', 'mixed', 'rest'];

/**
 * Response schema handed to Gemini.
 *
 * `enum` on `dayKey` and `type` closes those fields entirely. Exercise and
 * station ids cannot be closed the same way — the lists are supplied per
 * request — so they are constrained by the prompt and then checked properly by
 * the client's validator, which owns the real catalogue.
 */
function responseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      summary: {
        type: 'STRING',
        description: 'One sentence on the approach taken and why it suits this person.',
      },
      days: {
        type: 'ARRAY',
        minItems: 7,
        maxItems: 7,
        items: {
          type: 'OBJECT',
          properties: {
            dayKey: { type: 'STRING', enum: DAY_KEYS },
            label: { type: 'STRING', description: 'Short title, e.g. "Strength A" or "Longer Cardio".' },
            type: { type: 'STRING', enum: SESSION_TYPES },
            sub: { type: 'STRING', description: 'One line under the title, e.g. "Full body · 45-60 min".' },
            note: { type: 'STRING', description: 'A short paragraph on how to run the session.' },
            outline: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'The session as 2-4 ordered steps in plain language a beginner can follow.',
            },
            aerobic: {
              type: 'BOOLEAN',
              description: "True when this session's minutes count toward weekly aerobic exercise.",
            },
            minutes: {
              type: 'INTEGER',
              description: 'Duration for timed sessions. Omit for pure strength days.',
            },
            modalityStations: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Station ids from the supplied list. Required for timed sessions.',
            },
            exerciseIds: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Exercise ids from the supplied list. Required for strength days.',
            },
            exerciseFormat: { type: 'STRING', enum: ['circuit', 'sets'] },
            rounds: { type: 'STRING', description: 'Rounds through a circuit, e.g. "2-3". Circuits only.' },
          },
          required: ['dayKey', 'label', 'type', 'sub', 'note', 'outline', 'aerobic'],
        },
      },
    },
    required: ['summary', 'days'],
  };
}

function buildPrompt(request) {
  const { profile, conditions = [], notes = '', exercises = [], stations = [], goals } = request;

  const exerciseLines = exercises
    .map((e) => `- ${e.id}: ${e.name}${e.muscles ? ` (${e.muscles.join(', ')})` : ''}`)
    .join('\n');

  const stationLines = stations.map((s) => `- ${s.id}: ${s.name} [${s.zone}]`).join('\n');

  const person = profile
    ? `Age ${profile.age}. Bodyweight ${profile.bodyweight} ${profile.bodyweightUnit}. Training experience: ${profile.level}.`
    : 'No profile supplied — assume a general adult beginner and stay conservative.';

  const health = conditions.length > 0 ? conditions.join(', ') : 'none stated';

  return `You are programming one week of training for a single person using a specific gym.

PERSON
${person}
Health context: ${health}
${notes ? `This week: ${notes}` : ''}

WEEKLY TARGETS
At least ${goals?.minutes ?? 150} minutes of moderate aerobic activity.
At least ${goals?.strength ?? 2} full-body strength sessions.
Spread strength days apart — avoid back-to-back.

AVAILABLE EXERCISES — you MUST use these ids exactly and MUST NOT invent others:
${exerciseLines}

AVAILABLE STATIONS — you MUST use these ids exactly and MUST NOT invent others:
${stationLines}

RULES
1. Return exactly seven days, one per dayKey, covering sun through sat.
2. Use only the ids listed above. Never invent an exercise or a station id.
3. Never prescribe weights, loads or set counts — the app computes those from
   the person's own logged history.
4. Strength days need exerciseIds. Timed days (duration, intervals, mixed) need
   minutes and modalityStations.
5. "outline" must be 2-4 short steps a complete beginner can follow, in order,
   naming what they actually do. Avoid jargon.
6. Set aerobic true only for sessions whose minutes are genuinely cardiovascular.
7. Rest days use type "rest" with aerobic false and no exercises or minutes.
8. Health context should shape intensity and impact choices, not be mentioned in
   the copy you write.`;
}

/** Thrown for conditions the caller should see verbatim. */
export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/**
 * Ask Gemini for a week. Returns the parsed plan object, unvalidated —
 * content validation is the client's job, against the real catalogue.
 */
export async function generatePlan(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is not set on the server.', 503);
  }

  const model = request.model || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Header rather than a query parameter, so the key stays out of URLs,
        // proxy logs and error messages.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema(),
          // Some variety between regenerations, without going incoherent.
          temperature: 0.9,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new GeminiError('Gemini took too long to respond.', 504);
    }
    throw new GeminiError(`Could not reach Gemini: ${error?.message ?? 'unknown error'}`, 502);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();

  if (!response.ok) {
    // Surface the upstream message — a wrong model name or a disabled API is
    // otherwise indistinguishable from a bug in this code.
    throw new GeminiError(`Gemini returned ${response.status}: ${truncate(raw, 400)}`, 502);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new GeminiError('Gemini returned a response that was not JSON.', 502);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    const reason = payload?.candidates?.[0]?.finishReason ?? payload?.promptFeedback?.blockReason;
    throw new GeminiError(
      reason ? `Gemini returned no plan (${reason}).` : 'Gemini returned no plan content.',
      502,
    );
  }

  try {
    return { plan: JSON.parse(text), model };
  } catch {
    throw new GeminiError('Gemini returned malformed plan JSON.', 502);
  }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
