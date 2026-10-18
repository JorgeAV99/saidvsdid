import { expect, test } from 'vitest';

test('X', (ctx) => {
  let result = true;
  result ||= ctx.skip();
  expect(result).toBe(true);
});
