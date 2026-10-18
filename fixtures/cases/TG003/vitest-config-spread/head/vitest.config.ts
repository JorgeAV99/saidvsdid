import { defineConfig } from 'vitest/config';

const project = { globals: false, setupFiles: ['./setup.ts'] };

export default defineConfig({
  test: {
    globals: true,
    ...project,
  },
});
