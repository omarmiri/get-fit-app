# Rack & File

**Live: https://get-fit-app.onrender.com**

A personal training log built around one seven-day plan. Mobile-first, installable to the home screen, works offline in the gym.

**Bring your own plan.** Ask ChatGPT, Claude, Gemini or anything else for a training week and load it in — paste the reply, or open the file it gave you. The format is published at [`/llms.txt`](https://get-fit-app.onrender.com/llms.txt), so any model that can read a page can write a plan this app understands. See [Bringing a plan from an LLM](#bringing-a-plan-from-an-llm).

All data lives in the browser on the device you use it on. There is no database, no account, and nothing leaves the phone. **Export a backup from the Plan tab now and then** — clearing browser data erases everything.

---

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command          | What it does                                              |
| ---------------- | --------------------------------------------------------- |
| `npm run dev`    | Vite dev server with hot reload                           |
| `npm run build`  | Typecheck, then build to `dist/`                          |
| `npm start`      | Serve the built `dist/` on port 3000 — what Render runs   |
| `npm test`       | Run the test suite                                        |
| `npm run verify` | Typecheck, lint, test and build — run this before pushing |

`npm start` requires a build first; it exits with a clear message if `dist/` is missing.

---

## Features

- **Today** — opens on the current day's session, colour-coded by load
- **Fast set logging** — weight and reps steppers prefilled from last time, one tap to log, rest timer starts itself
- **Run clock** — start the cardio portion and it counts down, pauses for water breaks, and logs the time you _actually_ ran rather than the time you planned
- **Rest timer** — deadline-based, so it stays accurate when the phone screen sleeps mid-set
- **Progress charts** — estimated one-rep max per movement, aerobic minutes per week against the 150-minute target
- **Guided cues** — setup, execution and the common mistake for every movement
- **Weekly goals** — aerobic minutes, strength sessions, and a streak count
- **Guided progression** — rate each set Easy / Just right / Hard, and the next session opens at the weight and reps you've earned, with the reasoning shown
- **Ramps within a session too** — an easy set adds load for the next one straight away, sized to the movement (a leg press moves in bigger jumps than a lateral raise); a hard set ends the ramp
- **Session clock** — start the workout when you walk in and the finished session records how long it took, kept separate from aerobic minutes
- **Stagnation detection** — three sessions stuck at the same numbers triggers a deload suggestion instead of letting you grind
- **Safe starting weights** — optional one-time profile (age, bodyweight, experience) picks a deliberately conservative opening weight for movements you've never done
- **Equipment-aware** — every movement is tied to named equipment, with the zone to walk to, and you tap off whatever your gym lacks
- **Busy machine? Swap it** — tap "Taken?" for ranked alternatives, each with where to find it and a converted starting load
- **Units** — pounds or kilograms, switchable at any time without rewriting history
- **Bring a plan from any LLM** — copy a prompt, paste the answer back; the app checks it before anything is adopted
- **Export / import** — JSON backup, with validation on the way back in
- **Offline** — self-hosted fonts and a precached shell; no third-party requests at runtime

---

## Architecture

The app is a TypeScript single-page application with no UI framework. It is deliberately layered so that content, logic and rendering can change independently.

```
src/
├── types.ts            Domain model — every persisted and rendered shape
├── data/               Content: the plan, the exercise catalogue, plate colours
├── domain/             Pure logic: dates, units, metrics, input bounds
├── state/              Store, persistence, schema validation, derived reads
├── ui/                 DOM helpers, components, views
└── styles/             Tokens, base, layout, components
```

The dependency rule is one-directional: `ui` may import from `state`, `domain` and `data`; `state` may import from `domain` and `data`; `domain` and `data` import from nothing but `types`. Nothing in `domain/` or `state/` touches the DOM, which is why they can be tested without a browser.

### Key decisions

**Progression is arithmetic, not a language model.** `domain/progression.ts`
implements double progression — hold the weight and add reps to the top of the
range, then add load and reset — gated on reported effort, so a set that hit the
target but felt maximal does not earn an increase. It is deterministic, runs
offline, costs nothing, and is covered by tests that pin every branch. An LLM
would give different answers to identical history and occasionally suggest a
40 lb jump; this is the wrong shape of problem for that tool.

**Progression is scoped per exercise _and_ station.** A hack squat is not a leg
press. Swapping machines starts a separate progression rather than inheriting
numbers that mean something different.

**Within-session ramping is a separate rule from double progression.** Double
progression answers "where should today start" from past sessions and says
nothing once the first set is logged, which left early feeler sets repeating a
weight that already felt easy. `adjustAfterSet` fills that gap with larger,
movement-sized jumps — ramping to a working weight inside one session is a
different move from a week-over-week increase. Both are gated on the same
reported effort, and a hard set ends the ramp.

**Starting weights err light on purpose.** `domain/startingWeights.ts` rounds
_down_, always. The failure modes are not symmetric: too light costs one set,
too heavy on an unfamiliar movement costs weeks. The estimate stops mattering
the moment there is one real logged set.

**The equipment catalogue is a vocabulary, not an inventory.** `data/equipment.ts`
names common gym equipment so the app can say "your machine is taken, here are
three other things that train this and what to start at". It does not claim to
know what is on your floor — every station is assumed possibly-present, and the
only equipment fact the app holds is what _you_ mark missing. A test enforces
this: the catalogue may not name a gym chain, operator or manufacturer.

An earlier version described one specific club and graded each station by how
confident it was the machine was really there. That was honest about its
uncertainty but wrong about its job — it made the app a directory of one
building. Where you train is now free text you write yourself, and its real
consumer is the LLM you ask for a plan.

**Sets record which station they were performed on.** 180 on the leg press and
180 on the hack squat are not the same lift. Storing `stationId` keeps history
honest about what actually happened.

**Sets record their own unit.** A set logged as `45 lb` is stored as `{ weight: 45, unit: 'lb' }`, not normalised to a canonical unit. Switching the app to kilograms and back leaves the stored number untouched, instead of drifting to `44.9` through repeated conversion.

**Persisted state is versioned and validated.** Everything loaded from storage or an imported file goes through `state/schema.ts`, which never throws — unreadable records are dropped and counted rather than failing the whole load. There is no server to repair bad data, so the app has to cope with it.

**The store owns every mutation.** `state/store.ts` holds one immutable `AppState`. Views call actions and re-render from the result; nothing reaches into state directly. That keeps persistence and re-rendering in one place.

**No `innerHTML` anywhere.** All elements are built through `ui/dom.ts` with `textContent`, so imported backups and custom modality names can never be interpreted as markup.

**The service worker is generated.** Workbox builds it from the real asset manifest at build time, so each deploy revisions its own precache. The old routine of hand-bumping a `CACHE` constant is gone.

---

## Editing the plan

Everything is in `src/data/`.

- `exercises.ts` — the exercise catalogue, including each movement's stations
- `plan.ts` — which exercises belong to which day, and each day's guidance
- `equipment.ts` — the equipment vocabulary: what it is and which zone it lives in
- `plates.ts` — the accent colours

### Pointing the app at a different gym

Nothing to edit — describe your gym in the Plan tab and tap off any equipment it
does not have. Station ids are referenced by `exercises.ts` and `plan.ts`, and a
test fails loudly if any reference dangles.

### Adding a substitution

Add an entry to an exercise's `stations` array. The first is the default; the
rest are offered when it is taken. `loadFactor` seeds the converted weight
(`0.35` means start at 35% of the primary load) and `perHand` marks dumbbell-style
loading. These are starting points, not equivalences, and the UI says so.

`Exercise.id` is a permanent key: logged sets reference it forever. Renaming an exercise's `name` is free; changing its `id` orphans history unless you add an entry to `EXERCISE_ID_ALIASES` in `src/state/schema.ts`.

The tests in `tests/catalogue.test.ts` guard the content itself — duplicate ids, missing cues, a rep target that says "sec" on an exercise not marked as timed. They run on every change.

### Adding images, video or extra notes

The `Exercise` type already carries optional `media` and `tips` fields, and the exercise card renders them when present. Adding a photo is a data change, not a code change:

```ts
media: {
  image: '/media/leg-press.webp',
  alt: 'Feet shoulder-width on the mid platform, back flat against the pad',
  credit: 'Photo: …',
},
tips: ['Feet higher on the platform shifts work toward the glutes.'],
```

Put files in `public/media/`. Anything served from that path is runtime-cached by the service worker for 60 days, so it stays available offline after the first view.

---

## Deploying to Render

The repo includes `render.yaml`, so the fastest route is **Render → Blueprints → New Blueprint Instance**, pointed at this repo.

To configure it by hand instead:

| Setting           | Value                                   |
| ----------------- | --------------------------------------- |
| Runtime           | Node                                    |
| Build command     | `npm ci --include=dev && npm run build` |
| Start command     | `npm start`                             |
| Health check path | `/health`                               |

`--include=dev` matters: Vite and TypeScript are devDependencies and the build fails without them.

The server sets a strict Content-Security-Policy, serves fingerprinted assets as immutable, and forces revalidation on the HTML shell and service worker so a deploy actually reaches phones that already have the app installed.

---

## Data and privacy

Everything stays in `localStorage` on the device. No analytics, no third-party requests, no network calls of any kind after the initial load. The export file is plain JSON — it is your data, in a format you can read.

Data written by v0.1 is migrated automatically on first launch, including the exercise id that was renamed. The old storage key is left in place, so rolling back to the previous build does not lose anything.

---

## Testing

271 tests over the domain logic, the store, schema migration, the equipment catalogue, substitution, progression and plan-validation logic:

```bash
npm test
npm run test:coverage
```

The UI layer is verified by hand — the logic worth protecting from regressions lives below it, and that part runs without a DOM.

---

## Keeping the free instance awake

Render spins a free web service down after ~15 minutes idle, and the next
request waits ~50 seconds for a cold start. The app itself opens fine from the
service worker cache, so the only thing that really suffers is plan generation,
which has to reach the server.

Two layers, because neither is sufficient alone:

| Layer                             | What it does                                    | What it cannot do                                                               |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `keepalive.js`                    | Self-pings `/health` every 10 min while running | Wake a service that is already asleep — the pinging process is the sleeping one |
| `.github/workflows/keepalive.yml` | External cron every 10 min                      | Nothing; this is the one that matters                                           |

**The window is 8am–8pm New York time**, not around the clock. Free instance
hours are capped at 750/month against a ~730-hour month, so staying up
permanently would consume the entire allowance and leave nothing for a second
service. The window costs roughly 395 hours.

GitHub cron is UTC-only, so the schedule covers the union of the target window
across both US Eastern offsets (12:00–01:59 UTC) and the job then checks the
real New York hour and exits early outside it. `keepalive.js` reads the hour
through `Intl` rather than applying a fixed offset — a hardcoded `-5` would
silently shift the window by an hour for the eight months New York is on
daylight time. `tests/keepalive.test.ts` pins both offsets and the boundaries.

Set `KEEP_ALIVE=false` to disable the self-ping, and disable the workflow in the
Actions tab, if you move to a paid instance where none of this is needed.

## Bringing a plan from an LLM

The app accepts a training week written by any language model. The whole
contract is published at **`/llms.txt`**, generated at build time from the same
catalogue modules the parser uses — so the documentation cannot promise a field
the parser rejects. `/catalog.json` carries the built-in ids in machine-readable
form.

Two ways in, both landing on the same parser and the same validator:

| Route | For |
| --- | --- |
| **Copy prompt → paste the answer** | The normal path. The prompt carries the full format plus your gym, profile and health context. |
| **Open a plan file** | Phones, and whatever the model handed you as a download. On Android this covers Google Drive too, since Drive mounts in the system file picker. |

Both work offline and neither involves a third party.

### The division of labour

A plan file is **self-describing**: it may define movements this app has never
heard of, with their own cues, rep ranges, rest and equipment in plain English.
That is the point — no shipped catalogue covers every gym and every body.

Three things stay with the app, and the format gives an author no way to
override them:

- **Progression.** Loads after the first session come from your logged history
  via `domain/progression.ts`. An author may name an *opening* weight for a
  movement you have never done; it is used once, rounded down like every other
  starting estimate, and then never consulted again. The model says
  _dumbbell floor press, 8–12_; the app decides _30 lb_ from your own history.
- **Presentation.** `repRange` is derived from `repMin`/`repMax` rather than
  accepted, so `"8-12 GO HEAVY"` cannot land where a rep range belongs.
- **Identity.** Imported exercise ids are namespaced under `x:`. Logged sets
  reference exercise ids forever, so a plan that could define `legpress` would
  silently rewrite the meaning of every leg press already in your history. It
  cannot: it gets `x:legpress`, and the built-in id is untouched.

### Custom movements outlive the plan that defined them

A movement an imported plan invents lives in that plan — so replacing the plan
would strand every set logged against it. The numbers would survive, but
nothing could say what `x:sled-push` was, whether it counted reps or seconds,
or whether it belonged on a strength trend.

So `AppState.exerciseArchive` keeps a copy, written the first time a set is
logged against the movement. On logging rather than on plan replacement,
because that is the moment it stops being a suggestion and becomes part of the
record — and because it means the archive holds only what you actually
performed, not every movement of every plan you have tried. Entries nothing
references any more are dropped on load.

Resolution goes plan → archive → built-in. The plan wins when both can answer:
it describes what you are being asked to do _now_, while the archive explains
what you did _then_.

### The gate

Every plan passes `domain/planValidation.ts` before it can be adopted —
generated in-app, pasted from a chatbot, or loaded from a link, the same
deterministic checks either way.

- Errors block: unresolvable exercise or station ids, missing or duplicated
  days, strength days with no exercises, timed days with no duration or no
  description of what to do.
- Warnings inform: below the weekly aerobic target, too few strength days,
  back-to-back strength days, equipment you have marked absent, defined
  movements that no day uses, weighted movements naming no equipment.

The app cannot vouch for the *training advice* in a file someone's chatbot
wrote, and does not try to. What it guarantees is that the file will not break
the app, will not silently lose a day, and will not prescribe nothing on a day
claiming to be a workout — and that you see everything it noticed before you
commit. Nothing is saved until you accept it, and the built-in plan is always
one tap away.

`domain/planFormat.ts` is the parser: total, never throwing, with a cap on
every string an author controls. There is no server to repair a browser whose
only storage key has been filled with one pathological note.

## Generating a plan in-app (Gemini)

The convenience path, for when you do not want to leave the app. Set
`GEMINI_API_KEY` in the Render environment; the app hides the control when the
server reports no key, so it never offers a button that can only fail.

| Variable         | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `GEMINI_API_KEY` | Required. Read server-side only.          |
| `GEMINI_MODEL`   | Optional. Defaults to `gemini-2.5-flash`. |

**The key never reaches the browser.** `gemini.js` runs in the server process and
`/api/plan/generate` proxies the call. Never move this to a `VITE_`-prefixed
variable — Vite inlines those into the client bundle at build time.

This path is not privileged. Gemini emits the same format documented at
`/llms.txt`, and the response goes through the same parser and the same
validator as a stranger's pasted file. One format, one code path, one place for
a hole to be found by a test.

### Why there is no cloud-storage integration

There was briefly a Google Drive route: paste a share link, and a server proxy
fetched it. It was removed.

Using it required setting the file to "anyone with the link" — and a plan
generated from this app's prompt carries your health context, age and
bodyweight. Making that publicly fetchable to save a paste is a bad trade. The
Drive Picker would have avoided the public-sharing problem but needs an OAuth
client, a Google account and scripts from `apis.google.com`, and this app loads
nothing from anywhere: `script-src 'self'`, `connect-src 'self'`.

Both routes also cost something the remaining two do not — a working network
and a server. Paste and file import work on a phone in a basement gym. And on
Android, Drive appears in the system file picker anyway, so the file route
already covers the case the integration was meant to serve.

## Roadmap notes

**A language model belongs in plan structure, not progression.** Choosing and
arranging movements in response to "my shoulder hurts" is open-ended language
over a structured document, and there is no reasonable way to write rules for
it. Deciding whether to add 10 lb is arithmetic over your own history. The split
is enforced in code: an author can name an opening weight for a movement with no
history and nothing else, and the progression engine never calls the network.

## Not yet built

In-app plan editing, exercise photos and clips (the slots exist, the assets do not), Apple Health / Google Fit sync, body-metric tracking, multi-device sync.

---

This is a training log, not medical advice. Stop a session if you get chest pain, dizziness, or shortness of breath that feels out of proportion to the effort, and check with a doctor before increasing intensity.
