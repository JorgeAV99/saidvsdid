import { expect, test } from 'vitest';

(test as typeof test).skip('adds', () => {
  expect(1 + 1).toBe(2);
});
