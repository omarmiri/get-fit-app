import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Build the plan parser for the server process.
 *
 * ## Why this exists
 *
 * `domain/planFormat.ts` is the single parser for every inbound plan. Until
 * plans could only arrive by paste, that parser only ever needed to run in the
 * browser. A pushed plan arrives at the server instead, and the server has to
 * be able to answer two questions the client no longer can: is this a plan at
 * all, and — because the push endpoint is public — is what it is about to
 * store free of fields nobody asked for.
 *
 * The obvious alternatives are both worse. Storing the body unparsed and
 * validating on the way out gives a pushing model no feedback it can correct
 * against, and leaves whatever it sent sitting in the store in the meantime.
 * Hand-porting the parser to JavaScript creates a second copy of the rules,
 * which is precisely the failure this codebase keeps designing away from — the
 * same reason `llms.txt` is generated rather than written.
 *
 * So the TypeScript module is bundled, once, into something Node can import.
 * One source, two runtimes.
 *
 * ## Why the output is not committed
 *
 * It is a build artifact, like `dist/`. A checked-in copy is a copy that goes
 * stale the first time someone edits the parser — and staleness here means the
 * server and the browser disagree about what a valid plan is, which is the
 * exact class of bug this arrangement exists to prevent.
 */
export default defineConfig({
  // Without this, the PWA icons in `public/` are copied alongside the bundle —
  // harmless but confusing, and they are already served from `dist/`.
  publicDir: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Node, not a browser: no polyfills, no legacy downlevelling, and module
    // syntax the server's `type: "module"` can import directly.
    target: 'node22',
    outDir: 'server-lib',
    emptyOutDir: true,
    // The catalogues travel with the parser because resolving a built-in
    // exercise id is part of parsing. Minifying would make a stack trace from
    // the server useless for no meaningful saving on a cold start.
    minify: false,
    lib: {
      /*
       * Two entries, for the two things the server needs from the TypeScript
       * side: the parser that decides whether a pushed plan is a plan, and the
       * spec generator that tells a connected LLM what one looks like. Both
       * are read by the browser too — bundling rather than reimplementing is
       * what keeps the server and the app from disagreeing.
       */
      entry: {
        planFormat: fileURLToPath(new URL('./src/domain/planFormat.ts', import.meta.url)),
        planSpec: fileURLToPath(new URL('./src/spec/planSpec.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.mjs`,
    },
  },
});
