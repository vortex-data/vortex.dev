// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Transform JSX with the React automatic runtime for tests explicitly (no
  // `import React` needed; pulls from `react/jsx-runtime`), so the component
  // tests do not depend on tsconfig's `jsx` setting. That is `"react-jsx"` in
  // `tsconfig.json`; it was `"preserve"` before Next.js 16,
  // and Vite (rolldown/oxc) leaves preserved JSX untransformed.
  // Vite's transform option is `oxc`, not `esbuild`, under rolldown-vite; the
  // typed form of the automatic runtime is the `{ runtime: 'automatic' }`
  // object (the bare `'react-jsx'` string is runtime-valid but not in the type).
  oxc: { jsx: { runtime: 'automatic' } },
  // Mirror the `@/*` -> `src/*` path alias from tsconfig.json so tests can
  // import App Router route handlers (which use the `@/bench/...` convention).
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // bench's tests only: the site's run on `bun test tests/unit`. `lib/**`
    // unit + DB-backed tests, prop-driven component tests under
    // `components/**` that render via `react-dom/server` (no DOM env needed),
    // the stylesheet tests, and the route tests beside bench's routes.
    include: [
      'src/bench/lib/**/*.test.ts',
      'src/bench/components/**/*.test.tsx',
      'src/bench/styles/**/*.test.ts',
      // Escaped: unescaped, the parentheses are a glob group and match nothing.
      'src/app/\\(bench\\)/**/*.test.ts',
    ],
    // Pulling and starting the Postgres testcontainer can take tens of seconds
    // on a cold image cache, so the hook + test budgets are generous.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Restore `vi.spyOn` wrappers between tests so a spy on a module-singleton
    // (e.g. `hydrationQueue.schedule`) does not leak its instrumentation into
    // later tests in the same file.
    restoreMocks: true,
  },
});
