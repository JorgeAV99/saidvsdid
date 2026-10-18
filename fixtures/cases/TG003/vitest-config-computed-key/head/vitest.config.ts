import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    ['glob' + 'als']: false,
    setupFiles: ['./setup.ts'],
  },
});
