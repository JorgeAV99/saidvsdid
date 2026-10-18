import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['src/stats.test.ts'],
  },
});
