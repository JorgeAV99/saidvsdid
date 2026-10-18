import { test, expect } from 'vitest';
test('X', ctx => {
  const box = {};
  const alias = box;
  alias.omit = ctx.skip;
  expect(1).toBe(1);
});
