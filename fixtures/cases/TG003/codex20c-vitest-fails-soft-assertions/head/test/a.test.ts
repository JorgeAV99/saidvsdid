import { test, expect } from 'vitest';

test.fails('service', () => {
  expect.assertions(2);
  expect.soft(1).toBe(2);
});
