import { test, expect } from 'vitest';
test('X', ctx => {
  const box = { run() {
    this['omit'] = String;
  } };
  box.run();
  expect(1).toBe(1);
});
