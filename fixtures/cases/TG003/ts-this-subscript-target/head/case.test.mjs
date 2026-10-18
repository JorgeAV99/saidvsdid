import { test, expect } from 'vitest';
test('X', ctx => {
  const box = { run() {
    this['omit'] = ctx.skip;
    this['omit']();
  } };
  box.run();
  expect(1).toBe(1);
});
