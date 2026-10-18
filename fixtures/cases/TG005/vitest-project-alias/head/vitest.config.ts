import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        root: './tools',
        resolve: { alias: [{ find: /^\.\/InkLayer$/, replacement: './src/InkLayer.web.tsx' }] },
        test: { name: 'tools', include: ['tests/**/*.test.mjs'], environment: 'node' },
      },
    ],
  },
});
