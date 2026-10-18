import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        root: './tools',
        test: { name: 'tools', include: ['tests/**/*.test.mjs'], environment: 'node' },
      },
    ],
  },
});
