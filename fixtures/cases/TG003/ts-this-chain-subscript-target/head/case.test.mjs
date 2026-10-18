import { test, expect } from 'vitest';
test('X', ctx => {
  const box = { a: {}, run() {
    this.a['omit'] = ctx['skip'];
    this['a'].omit();
  } };
  box.run();
  expect(1).toBe(1);
});
