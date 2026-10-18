import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ['./setup.ts'],
  },
});
