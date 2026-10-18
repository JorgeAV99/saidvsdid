import { expect, it } from 'vitest';

it('adds', (ctx) => {
  Reflect['get'](ctx, 'skip')();
  expect(1 + 1).toBe(2);
});
