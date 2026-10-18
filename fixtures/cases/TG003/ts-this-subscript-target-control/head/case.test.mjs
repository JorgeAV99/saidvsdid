import { test, expect } from 'vitest';
test('X', ctx => {
  const box = { run() {
    this['omit'] = String;
    this['omit']('x');
  } };
  box.run();
  expect(1).toBe(1);
});
