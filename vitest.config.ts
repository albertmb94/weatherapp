import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Only run tests that live in app/, components/, lib/, scripts/
    // and the e2e helpers. .opencode/ is an internal agent bundle and
    // owns its own vitest tree; including it spews unrelated failures.
    include: [
      'app/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', '.opencode', '.agents', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Per-area coverage thresholds (Sprint 9). The pure-logic lib/
      // carries the bulk of the unit tests; the React surface area
      // has good but lower coverage. These thresholds are loose enough
      // to reflect that, while still flagging large regressions.
      thresholds: {
        'lib/': { lines: 70, functions: 70, branches: 65 },
        'app/api/': { lines: 65, functions: 60, branches: 55 },
        'components/': { lines: 35, functions: 30, branches: 30 },
      },
      exclude: [
        'node_modules',
        '.next',
        '.opencode',
        '.agents',
        'e2e',
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        // Indexers / scripts are tooling, not application runtime.
        'lib/indexer/**',
        'scripts/**',
      ],
      // The coverage-v8 plugin needs to be installed as a devDependency
      // before `npm run test:coverage` works. Run
      // `npm i -D @vitest/coverage-v8` once. We avoid listing it as a hard
      // dependency so the lockfile churn doesn't break existing installs.
      enabled: false,
    },
  },
})
