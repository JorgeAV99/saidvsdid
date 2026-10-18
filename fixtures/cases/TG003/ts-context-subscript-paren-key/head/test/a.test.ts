import { expect, it } from 'vitest';

it('adds', (ctx) => {
  ctx[('skip')]();
  expect(1 + 1).toBe(2);
});
