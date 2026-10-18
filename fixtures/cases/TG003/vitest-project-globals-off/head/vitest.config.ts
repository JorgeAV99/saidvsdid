import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          globals: false,
          include: ['test/**/*.test.ts'],
          setupFiles: ['./setup.ts'],
        },
      },
    ],
  },
});
