/*
 * Relative imports, not the `@/` alias.
 *
 * `vite.config.ts` imports this module to emit the spec at build time, and the
 * config is loaded before Vite's alias resolution is available — an aliased
 * value import anywhere in this module's dependency chain fails the build with
 * a module-not-found error. That failure is loud and immediate, so the build
 * itself enforces this rule; type-only imports are erased and stay aliased.
 */
import { ALL_EXERCISES } from '../data/exercises';
import { ALL_STATIONS, ZONE_LABEL } from '../data/equipment';
import { GOALS } from '../data/plan';
import { PLAN_FORMAT_VERSION, PLAN_KIND } from '../domain/planFormat';

/**
 * The contract, written for a language model.
 *
 * ## Why this is generated rather than hand-written
 *
 * This text tells an LLM exactly what a plan file must contain. It names the
 * built-in exercise and station ids, and it describes fields whose limits live
 * in `domain/planFormat.ts`. Hand-maintaining it would guarantee that one day
 * the spec promises something the parser rejects — and the person who finds
 * out is a user whose plan was refused for reasons the documentation said were
 * fine.
 *
 * So it is built from the same modules the parser uses, emitted to `/llms.txt`
 * at build time, and reused verbatim by the "copy a prompt" button. One source,
 * three consumers.
 *
 * ## What it has to accomplish
 *
 * A model reading this has never seen the app. It needs to know, without
 * guessing: what shape to emit, what the app fills in versus what it must
 * supply, and — the part that is easy to get wrong — that it must NOT
 * prescribe per-set loads, because the app computes those from the user's
 * logged history and will ignore anything else.
 */

/** What the app knows about the person, for the prompt it hands them. */
export interface PromptContext {
  /** Where they train, in their own words. */
  readonly gym?: string;
  /** Movements they want included or avoided, in their own words. */
  readonly likes?: string;
  readonly age?: number;
  readonly bodyweight?: number;
  readonly bodyweightUnit?: string;
  readonly level?: string;
  readonly conditions?: readonly string[];
  /** Anything to work around this week. */
  readonly notes?: string;
  /** Equipment they have marked as absent. */
  readonly missingEquipment?: readonly string[];
}

/**
 * Where a finished plan can be posted, for a model able to make the call.
 *
 * Only the push id travels here. The poll token that reads the session stays
 * in the browser — see the note on the two ids in `sessions.js`.
 */
export interface DropTarget {
  readonly pushId: string;
  /** Absolute, because the model is not on this origin. */
  readonly endpoint: string;
}

/**
 * A ready-to-paste prompt for whichever LLM the user prefers.
 *
 * Carries the full contract inline rather than only linking to it. A link
 * would be shorter and would work beautifully in the chat apps that can
 * browse — and would fail silently in the ones that cannot, producing a plan
 * in some invented format that the user then cannot import and cannot debug.
 * The URL is included too, for models that would rather fetch the current
 * version.
 *
 * The user's own details go at the top, where they are least likely to be lost
 * in a long document.
 */
/**
 * The person, as bullet points, for whichever prompt is being built.
 *
 * Their own details go first in both, where they are least likely to be lost
 * in a long document.
 */
function describe(context: PromptContext): string {
  const person: string[] = [];

  if (context.age) person.push(`- Age: ${context.age}`);
  if (context.bodyweight) {
    person.push(`- Bodyweight: ${context.bodyweight} ${context.bodyweightUnit ?? 'lb'}`);
  }
  if (context.level) person.push(`- Training experience: ${context.level}`);
  if (context.conditions?.length) person.push(`- Health context: ${context.conditions.join(', ')}`);
  if (context.notes) person.push(`- This week: ${context.notes}`);
  if (context.gym) person.push(`- Where I train: ${context.gym}`);
  if (context.likes) person.push(`- Movements I enjoy or want to avoid: ${context.likes}`);
  if (context.missingEquipment?.length) {
    person.push(`- My gym does NOT have: ${context.missingEquipment.join(', ')}`);
  }

  return person.length > 0
    ? person.join('\n')
    : '- (I have not filled in my details — assume a general adult beginner and stay conservative.)';
}

/**
 * The prompt that travels in a launcher link.
 *
 * A URL holds a few thousand characters and the specification is fifteen
 * thousand, so this is what is left when the contract has to be fetched rather
 * than carried: the person, and directions to the format.
 *
 * ## Why it does not mention the connector or a session
 *
 * Because the model reading it demonstrably does not have either. This prompt
 * only ever arrives by opening a chat product from a link, and every product
 * that can be opened that way was tested: none of them can call an MCP server
 * or make an HTTP request. Naming a session id here would ask for a delivery
 * that cannot happen, and — worse — would leave the app watching for it.
 *
 * ## Why it names the site twice
 *
 * The first version said only "use the rack-and-file tools", which assumed the
 * one thing it had no business assuming: that they were already there. A model
 * without them could not find the app, could not find the format, and —
 * because this prompt deliberately omits the specification — could not fall
 * back to writing JSON either. It would invent a shape and produce a file the
 * parser rejects, which is worse than refusing, because it looks like success
 * until the import fails.
 *
 * So it degrades honestly: fetch the spec and answer, or say plainly that you
 * cannot, so the user can reach for the long prompt instead.
 */
export function buildLinkPrompt(context: PromptContext, siteUrl: string): string {
  return `Please write me a one-week training plan for Rack & File (${siteUrl}).

ABOUT ME
${describe(context)}

HOW TO WRITE IT

Fetch ${siteUrl}/llms.txt first — that page is the complete format, and it is
short. Then reply with the plan as one JSON object in a single code block,
with nothing else inside that block, so I can copy it in one tap. Anything you
want to say about the plan goes outside the block.

If you cannot fetch that page, say so plainly rather than guessing at the
format — I will paste you a longer prompt that carries the whole
specification inline.`;
}

/**
 * The short version, for someone who really has added the connector.
 *
 * The full prompt carries the whole contract inline — about 15kb — because a
 * plain chat model has no way to go and read it. A connected client does: it
 * calls `get_plan_format` itself. So the paste shrinks to the part the tools
 * cannot supply, which is the person and their session id.
 *
 * ## Why this is offered rather than used by default
 *
 * No consumer chat product ships this connector, and none of the six tested
 * could call it. The one who knows whether a client has it is the person using
 * that client, so the app asks rather than guesses — this prompt is behind a
 * button that says what it is for, and every other route uses
 * `buildLinkPrompt` or `buildPrompt` instead.
 *
 * It still degrades rather than assuming: a client that turns out not to have
 * the tools is told where the format is, and one that can do neither is told
 * to say so instead of guessing at a shape the parser will reject.
 */
export function buildBriefPrompt(context: PromptContext, pushId: string, siteUrl: string): string {
  return `Please write me a one-week training plan for Rack & File (${siteUrl}).

ABOUT ME
${describe(context)}

HOW TO SEND IT BACK

If you have the rack-and-file tools — the MCP connector at ${siteUrl}/mcp —
call get_plan_format for the specification, then submit_plan with sessionId
"${pushId}". If submit_plan rejects the plan, the error says exactly what is
wrong: fix it and submit again.

If you do not have those tools but can fetch a URL, read ${siteUrl}/llms.txt
for the format, then reply with the plan as JSON in a single code block and I
will paste it in myself.

If you can do neither, say so plainly rather than guessing at the format — I
will paste you a longer prompt that carries the whole specification inline.`;
}

export function buildPrompt(context: PromptContext, siteUrl?: string, drop?: DropTarget): string {
  const about = describe(context);

  /*
   * Deliberately not "ask me first".
   *
   * That was the original wording, and Perplexity showed why it fails: asked
   * to find out about equipment before writing, it expressed the *question* as
   * a plan — seven rest days labelled "Awaiting Equipment". A tool that
   * answers in one shot cannot hold the conversation the instruction assumes,
   * so the instruction has to yield something usable on the first pass.
   *
   * Stating an assumption is correctable. Asking is a dead end.
   */
  const gymPrompt = context.gym
    ? ''
    : '\nI have not described my gym. Do not stop to ask and do not reply with questions — assume a typical commercial gym, write the full week, and say what you assumed in the summary so I can correct you.\n';

  return `Please write me a one-week training plan as a JSON file for an app called Rack & File.

ABOUT ME
${about}
${gymPrompt}
${deliverySection(drop)}The complete format follows.${
    siteUrl ? ` The current version of this specification is also at ${siteUrl}/llms.txt.` : ''
  }

---

${buildLlmsTxt()}`;
}

/**
 * How the finished plan gets back to the app.
 *
 * ## Why the default no longer asks for a push
 *
 * It used to ask every model to POST the plan, on the theory that the ones
 * which could would save the user a paste. Tested against six products, none
 * could: ChatGPT, Claude, Perplexity, Grok, Gemini and Copilot all either
 * declined, printed a curl command, or said they had sent something they had
 * not. The paragraph cost a fifth of the prompt and bought nothing, and asking
 * for an impossible thing first is not free — a model that opens by working
 * out how to make an HTTP request is a model not yet writing a training plan.
 *
 * Nor can this be rescued by making the transport smaller. A full week runs to
 * six to twelve kilobytes of JSON, so the obvious alternatives — a link the
 * model builds, a GET with the plan in the query string — come out at twelve
 * to twenty-four kilobytes of URL, past what any chat window will render as a
 * link or any browsing tool will fetch. The plan is simply too big to travel
 * as an address.
 *
 * So the default prompt now asks for the one thing every product does well:
 * a clean code block. The push survives for clients that really do have the
 * connector, where `drop` is passed and this section still describes it.
 *
 * ## Why that version asks for both
 *
 * Most chat products cannot POST. Browsing tools fetch, code sandboxes have no
 * network, and a model in a plain chat window given only an endpoint will
 * either refuse, print a curl command, or — the expensive one — announce that
 * it has sent the plan when nothing was sent. The user then waits for
 * something that is never coming and concludes the app is broken.
 *
 * So the instruction asks for the push *and* requires the JSON in the reply
 * either way. A tool-capable client does both and the app picks it up
 * instantly; a plain chat window does the half it can, and the user pastes.
 * Neither path is a failure mode, and the app is never the one guessing which
 * happened — it either received a push or it did not, and the screen says so
 * rather than trusting anything the model claims.
 *
 * The honesty instruction is there for the same reason. A model that quietly
 * imagines it made a network call is worse than one that says it cannot.
 */
function deliverySection(drop?: DropTarget): string {
  if (!drop) {
    /*
     * "Nothing else in that block" is the whole point of this sentence.
     *
     * Every chat product puts a copy button on a fenced code block, and that
     * button is the shortest path a plan has back to the app — one tap, no
     * selection, no scrolling to find where the JSON ends. It only works if
     * the block holds the plan and nothing else, so a model that likes to
     * annotate its output has to be told where the annotations go.
     */
    return (
      'Reply with the plan as one JSON object in a single code block, with ' +
      'nothing else inside that block, so I can copy it in one tap. Anything ' +
      'you want to say about the plan goes outside the block. '
    );
  }

  return `DELIVERING THE PLAN

Two things, in this order:

1. If — and only if — you can make HTTP requests, POST the plan JSON to:

   ${drop.endpoint}

   Send it as the request body with \`Content-Type: application/json\`, either
   as the plan object itself or wrapped as {"plan": {...}}. A 201 means the app
   has it. If you get a 4xx, the response body says what was wrong with the
   plan — fix it and post the corrected version.

   If you cannot make HTTP requests, skip this step and say so plainly. Do not
   say you have sent it when you have not.

2. Either way, reply with the JSON in a single code block, so I can paste it in
   myself if the POST did not happen.

`;
}

/** Machine-readable catalogue, emitted to `/catalog.json`. */
export function buildCatalog(): object {
  return {
    kind: 'rackfile.catalog',
    formatVersion: PLAN_FORMAT_VERSION,
    note: 'Built-in movements and equipment. A plan may reference these ids, or define its own movements. Neither list is a limit.',
    exercises: ALL_EXERCISES.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      muscles: exercise.muscles ?? [],
      repMetric: exercise.repMetric,
      loaded: exercise.loaded,
    })),
    stations: ALL_STATIONS.map((station) => ({
      id: station.id,
      name: station.name,
      zone: ZONE_LABEL[station.zone],
      kind: station.kind,
    })),
  };
}

/** The full contract as Markdown, emitted to `/llms.txt`. */
export function buildLlmsTxt(): string {
  return [
    header(),
    envelopeSection(),
    daySection(),
    exerciseSection(),
    loadSection(),
    rulesSection(),
    catalogueSection(),
    exampleSection(),
  ].join('\n\n');
}

function header(): string {
  return `# Rack & File — training plan format

> A training log that runs a seven-day rotation and tracks progressive overload.
> It accepts a training week written by any language model, as JSON the user
> pastes in or opens as a file from their device.

You are most likely reading this because someone asked you to write them a
training plan for this app. Everything you need is on this page. Emit **one
JSON object** in the format below and nothing else the user has to edit by hand.

If the person has not told you what equipment they have, do not stop to ask —
some tools reading this cannot hold a conversation. Assume a typical commercial
gym (dumbbells, adjustable benches, cable machines, treadmills, a squat rack)
and **say in your summary what you assumed**, so they can correct it and ask
again. A plan built on a stated assumption is useful; a request for information
they cannot answer is not.

The app does not know what is in their gym and cannot tell you — that is why it
asks you to describe equipment in plain English.`;
}

function envelopeSection(): string {
  return `## The envelope

\`\`\`json
{
  "kind": "${PLAN_KIND}",
  "formatVersion": ${PLAN_FORMAT_VERSION},
  "author": "<your model name>",
  "summary": "One or two sentences on the approach you took and why it suits this person.",
  "exercises": [ /* movement definitions — see below. Omit if you only use built-in ids. */ ],
  "days": [ /* exactly seven, one per dayKey */ ]
}
\`\`\`

| Field | Required | Notes |
| --- | --- | --- |
| \`kind\` | recommended | Identifies the file. A file with a different \`kind\` is refused. |
| \`formatVersion\` | recommended | Currently \`${PLAN_FORMAT_VERSION}\`. A higher number is refused rather than guessed at. |
| \`author\` | optional | Shown to the user so they know which model wrote the week. |
| \`summary\` | recommended | Shown before they accept the plan. |
| \`exercises\` | optional | Movements you are defining yourself. Up to 60. |
| \`days\` | **required** | Seven entries, \`sun\` through \`sat\`. |`;
}

function daySection(): string {
  return `## Days

One object per day of the week. All seven must be present; a day off is
\`"type": "rest"\`, not an omission.

| Field | Type | Notes |
| --- | --- | --- |
| \`dayKey\` | \`sun\`\\|\`mon\`\\|\`tue\`\\|\`wed\`\\|\`thu\`\\|\`fri\`\\|\`sat\` | **Required.** One of each. |
| \`label\` | string | **Required.** Short title, e.g. \`"Strength A"\`, \`"Longer Cardio"\`. |
| \`type\` | \`strength\`\\|\`duration\`\\|\`intervals\`\\|\`mixed\`\\|\`rest\` | **Required.** \`mixed\` means cardio plus movements. |
| \`sub\` | string | One line under the title, e.g. \`"Full body · 45–60 min"\`. |
| \`note\` | string | A paragraph on how to run the session. Blank lines are kept. |
| \`outline\` | string[] | **Required.** 2–4 ordered steps a beginner can follow. Name what they actually do. Avoid jargon. |
| \`aerobic\` | boolean | **Required.** \`true\` only when the minutes are genuinely cardiovascular. Drives the weekly aerobic total. |
| \`minutes\` | integer | **Required for timed days.** Omit on pure strength days. |
| \`exerciseIds\` | string[] | **Required for strength days.** Built-in ids, or ids you defined in \`exercises\`. |
| \`exerciseFormat\` | \`circuit\`\\|\`sets\` | \`circuit\` = all movements, repeated for rounds. \`sets\` = finish one before the next. |
| \`rounds\` | string | Rounds through a circuit, e.g. \`"2–3"\`. Circuits only. |
| \`modalityStations\` | string[] | Built-in station ids for the cardio, best first. |
| \`modality\` | string | **Use this when no built-in station fits.** Plain English: \`"the assault bike by the door"\`. A timed day needs one or the other. |`;
}

function exerciseSection(): string {
  return `## Defining your own movements

You are **not** limited to the built-in catalogue. If the person's gym, injury
history or experience calls for a movement this app has never heard of, define
it. A defined movement renders exactly like a built-in one.

| Field | Type | Notes |
| --- | --- | --- |
| \`id\` | string | Referenced from a day's \`exerciseIds\`. Slugged from \`name\` if omitted. Namespaced on import, so it can never collide with a built-in id. |
| \`name\` | string | **Required.** Up to 80 characters. |
| \`summary\` | string | **Write this.** One plain sentence saying what the movement physically *is* — "sit and push a weighted platform away with both legs". Exercise names are jargon; a name the user cannot picture is a movement they skip. |
| \`equipment\` | string | **Write this for anything loaded.** Plain English: \`"adjustable bench and one dumbbell"\`. This is the authoritative description of what they need. |
| \`stationId\` | string | Optional. A built-in station id, if one happens to fit. When it matches, the app can offer alternatives if the machine is busy. An unrecognised value is dropped harmlessly. |
| \`sets\` | integer | Working sets. 1–12. Defaults to 3. |
| \`repMin\` / \`repMax\` | integer | The rep range as numbers. The app renders the display range itself. |
| \`repMetric\` | \`reps\`\\|\`seconds\` | \`seconds\` for holds and carries. Defaults to \`reps\`. |
| \`loaded\` | boolean | **Required for anything with weight.** \`false\` for bodyweight movements — it decides whether a weight stepper appears at all. |
| \`restSeconds\` | integer | Rest between sets. 0–600. Defaults to 90 (45 for timed holds). |
| \`cues.setup\` | string | How to get into position before the first rep. |
| \`cues.execute\` | string | What to do during the rep. |
| \`cues.avoid\` | string | The single most common way this movement goes wrong. |
| \`alternative\` | string | An easier or equipment-free substitute. |
| \`muscles\` | string[] | Primary muscles worked. |
| \`tips\` | string[] | Up to 6 extra coaching notes. |
| \`openingWeight\` | \`{ value, unit }\` | See below. |
| \`inverseLoad\` | boolean | **Set this for assisted machines and band-assisted work**, where a higher number means *easier*. See below. |

Write all three cues. They are the difference between a movement someone
performs correctly and one they perform approximately. If you leave them out
the app fills in a line saying the plan did not supply them, which is honest
but useless to the person in the gym.`;
}

function loadSection(): string {
  return `## Weights, reps and rest — read this carefully

This is the part most likely to be got wrong, because it differs from what a
training plan normally looks like.

**Do not prescribe per-set weights.** The app computes every working load from
the user's own logged history. After each set they tap Easy / Just right /
Hard, and \`progression.ts\` decides what the next set and the next session
open at, sized to the movement. Any load you write into a day's prose is
ignored by that engine and will contradict what the app shows on screen.

**Do supply \`openingWeight\` for movements you define.** For a movement the
user has never logged, there is no history to compute from, and the app's
fallback is a crude bodyweight ratio. A number from someone who knows the
movement is better. It is used exactly once — the moment there is one real
logged set, progression takes over permanently.

\`\`\`json
"openingWeight": { "value": 45, "unit": "lb" }
\`\`\`

Bias it low. Starting too light costs one set; starting too heavy on an
unfamiliar movement costs weeks. The app rounds it down to a loadable
increment and presents it as a floor to work up from. It is ignored on
movements where \`loaded\` is \`false\`.

**Assisted movements need \`inverseLoad: true\`.** On an assisted pull-up or dip
machine the stack is counterweight — 80 lb is *easier* than 40, and getting
stronger means the number going down. Band-assisted work is the same. Without
this flag the app progresses those movements backwards: an easy set earns more
assistance. With it, everything flips correctly — progression, deloads, and the
direction the opening estimate rounds.

\`\`\`json
{ "name": "Assisted pull-up", "loaded": true, "inverseLoad": true,
  "openingWeight": { "value": 80, "unit": "lb" } }
\`\`\`

Bias an assisted opening weight *high*, not low — more help is the cautious
mistake there, the mirror of everything above.

**Reps are a range, not a number.** Give \`repMin\` and \`repMax\`. The app shows
the range and progresses the user through it before adding load.

**Rest is per movement, in seconds.** The app runs a rest timer from it. Heavy
compound work wants 90–180; isolation and core work 45–60.`;
}

function rulesSection(): string {
  return `## Rules

1. Exactly seven days, one per \`dayKey\`, \`sun\` through \`sat\`.
2. Never prescribe loads for individual sets. See above.
3. Strength days need \`exerciseIds\`. Timed days need \`minutes\` and either
   \`modalityStations\` or \`modality\`.
4. \`outline\` must be 2–4 short ordered steps a complete beginner can follow.
5. Set \`aerobic\` true only for sessions whose minutes are genuinely
   cardiovascular. A strength session takes time but is not aerobic minutes.
6. Rest days use \`"type": "rest"\`, \`aerobic: false\`, and no exercises or minutes.
7. Health conditions the user mentions should shape intensity, impact and
   movement selection. Do not write them into the copy the user reads — they
   know what they told you.
8. Weekly targets the app checks against: at least **${GOALS.minutes} aerobic minutes**
   and **${GOALS.strength} strength sessions**. Falling short is allowed and warned about,
   not blocked.
9. Spread strength days apart rather than back to back.
10. Emit only the JSON object. A fenced code block is fine; commentary around
    it is tolerated but unnecessary.`;
}

function catalogueSection(): string {
  const exercises = ALL_EXERCISES.map(
    (exercise) => `| \`${exercise.id}\` | ${exercise.name} | ${(exercise.muscles ?? []).join(', ') || '—'} |`,
  ).join('\n');

  const stations = ALL_STATIONS.map(
    (station) => `| \`${station.id}\` | ${station.name} | ${ZONE_LABEL[station.zone]} |`,
  ).join('\n');

  return `## Built-in movements

Reference these by id and the user inherits everything the app already knows
about them: coaching cues, machine substitutions, load conversions and a
conservative opening weight. Prefer them when they fit — but do not contort a
plan to avoid defining your own.

| id | Name | Muscles |
| --- | --- | --- |
${exercises}

## Built-in equipment

Optional hints. Use an id when one fits, and \`equipment\` or \`modality\` prose
when none does. Naming equipment this list does not contain is expected and
costs nothing.

| id | Name | Where |
| --- | --- | --- |
${stations}

Also available as JSON at \`/catalog.json\`.`;
}

function exampleSection(): string {
  const example = {
    kind: PLAN_KIND,
    formatVersion: PLAN_FORMAT_VERSION,
    author: 'example-model',
    summary:
      'Two full-body strength days spread apart, three cardio days, and a genuine rest day, built around dumbbells and a bench.',
    exercises: [
      {
        id: 'db-floor-press',
        name: 'Dumbbell floor press',
        summary: 'Lie on your back on the floor and press two dumbbells straight up from your chest.',
        equipment: 'Two dumbbells, floor space',
        stationId: 'dumbbells',
        sets: 3,
        repMin: 8,
        repMax: 12,
        repMetric: 'reps',
        loaded: true,
        restSeconds: 90,
        muscles: ['Chest', 'Triceps'],
        openingWeight: { value: 20, unit: 'lb' },
        alternative: 'Push-up',
        cues: {
          setup: 'Lie flat, knees bent, dumbbells at chest height with elbows resting on the floor.',
          execute: 'Press straight up until the arms lock softly, then lower until the elbows touch down.',
          avoid: 'Bouncing the elbows off the floor to start the next rep.',
        },
      },
    ],
    days: [
      {
        dayKey: 'mon',
        label: 'Strength A',
        type: 'strength',
        sub: 'Full body · 45 min',
        note: 'Rest 60–90 seconds between sets. Stop each set one or two reps before your form breaks down.',
        outline: [
          'Five minutes easy on any machine to warm up',
          'Four movements, three sets each',
          'Stretch for five minutes',
        ],
        aerobic: false,
        exerciseFormat: 'sets',
        exerciseIds: ['legpress', 'db-floor-press', 'seatedrow', 'plank'],
      },
      {
        dayKey: 'tue',
        label: 'Steady Cardio',
        type: 'duration',
        sub: '40 min conversational',
        note: 'Keep it at a pace where you could still hold a conversation.',
        outline: ['Forty minutes steady', 'Five minutes stretching after'],
        aerobic: true,
        minutes: 40,
        modalityStations: ['treadmill', 'elliptical'],
      },
      {
        dayKey: 'wed',
        label: 'Rest',
        type: 'rest',
        sub: 'Nothing scheduled',
        note: 'Walk if you feel like it. Otherwise rest properly — this is where the adaptation happens.',
        outline: ['Rest'],
        aerobic: false,
      },
    ],
  };

  return `## A worked example

Abbreviated to three days for length. A real plan has all seven.

\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\``;
}
