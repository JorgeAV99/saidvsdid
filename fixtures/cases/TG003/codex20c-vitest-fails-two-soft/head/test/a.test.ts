import { test, expect } from 'vitest';

test.fails('service', () => {
  expect.soft(1).toBe(2);
  expect.soft(3).toBe(4);
});
