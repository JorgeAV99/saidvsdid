import { defineConfig } from 'vitest/config';

// Unit tests run in node; keep the default timeout.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 5000,
  },
});
