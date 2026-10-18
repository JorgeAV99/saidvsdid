import { expect, test } from 'vitest';

test('X', (ctx) => {
  expect(1).toBe(2);
  ctx.skip();
});
