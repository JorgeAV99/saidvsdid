import { defineConfig } from 'vitest/config';
import { skipped } from './test-scope.js';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], exclude: skipped },
});
