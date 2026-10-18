import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Explicit include: fixtures/cases/** contains test files that are *data*
    // (with .only, .skip, ...) and must never be collected by our own runner.
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
