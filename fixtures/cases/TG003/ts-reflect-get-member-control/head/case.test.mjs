import { test, expect } from 'vitest';
test('X', ctx => {
  const box = {};
  const alias = box;
  alias.omit = () => 1;
  Reflect.get(box, 'omit')();
  expect(1).toBe(1);
});
