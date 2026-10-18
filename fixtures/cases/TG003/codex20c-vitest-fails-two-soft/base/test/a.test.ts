import { test, expect } from 'vitest';

test('service', () => {
  expect.soft(1).toBe(2);
  expect.soft(3).toBe(4);
});
