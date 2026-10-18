import { test, expect } from 'vitest';

test('service', () => {
  expect.assertions(2);
  expect.soft(1).toBe(2);
});
