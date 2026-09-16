import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * `sessions.js` imports the parser from `server-lib/`, which is a build
       * artifact and does not exist when the tests run — `npm run verify` puts
       * `test` before `build` on purpose, so that a broken test stops the
       * build rather than following it.
       *
       * Pointing the alias at the TypeScript source is not a substitute for
       * the real thing, it *is* the real thing: `vite.server.config.ts`
       * bundles this exact module. Testing the source means a test cannot pass
       * against a stale bundle.
       */
      './server-lib/planFormat.mjs': fileURLToPath(new URL('./src/domain/planFormat.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/state/**', 'src/data/**'],
      reporter: ['text', 'html'],
    },
  },
});
