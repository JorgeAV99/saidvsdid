import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/a/vitest.unit.config.ts'] },
});
