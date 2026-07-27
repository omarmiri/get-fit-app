# Rack & File

A personal training log built around one seven-day plan. Mobile-first, installable to the home screen, works offline in the gym.

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
- **Rest timer** — deadline-based, so it stays accurate when the phone screen sleeps mid-set
- **Progress charts** — estimated one-rep max per movement, aerobic minutes per week against the 150-minute target
- **Guided cues** — setup, execution and the common mistake for every movement
- **Weekly goals** — aerobic minutes, strength sessions, and a streak count
- **Equipment-aware** — every movement is tied to real stations at your club, with the zone to walk to
- **Busy machine? Swap it** — tap "Taken?" for ranked alternatives, each with where to find it and a converted starting load
- **Units** — pounds or kilograms, switchable at any time without rewriting history
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

**Equipment data is split by confidence, and the user can correct it.** LA Fitness
publishes club amenities but not machine inventories, and no third party does
either. So `data/equipment.ts` marks each station `club-confirmed` (traceable to
the club's published amenities) or `chain-standard` (the chain's usual lineup,
_not_ verified for this location). Unconfirmed stations are labelled as such in
the UI, and anything you mark missing stops being suggested. A test enforces the
split: a station cannot claim `club-confirmed` unless the club profile backs it.

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
- `equipment.ts` — the station catalogue: what it is, where it is, how sure we are
- `club.ts` — the home club's address, hours, amenities and classes
- `plates.ts` — the accent colours

### Pointing the app at a different gym

Replace `club.ts` and adjust `equipment.ts`. Nothing else references the address,
hours or class list. Station ids are referenced by `exercises.ts` and `plan.ts`,
and a test fails loudly if any reference dangles.

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

193 tests over the domain logic, the store, schema migration, the equipment catalogue and the substitution logic:

```bash
npm test
npm run test:coverage
```

The UI layer is verified by hand — the logic worth protecting from regressions lives below it, and that part runs without a DOM.

---

## Not yet built

In-app plan editing, exercise photos and clips (the slots exist, the assets do not), Apple Health / Google Fit sync, body-metric tracking, multi-device sync.

---

This is a training log, not medical advice. Stop a session if you get chest pain, dizziness, or shortness of breath that feels out of proportion to the effort, and check with a doctor before increasing intensity.
