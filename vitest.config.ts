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
  },
})
