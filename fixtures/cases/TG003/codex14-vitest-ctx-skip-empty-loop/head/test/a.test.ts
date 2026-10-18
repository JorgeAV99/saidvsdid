import { expect, test } from 'vitest';

test('X', (ctx) => {
  for (const _ of []) {
    ctx.skip();
  }
  expect(1).toBe(1);
});
