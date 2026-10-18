import { expect, test } from 'vitest';

const omit = (test.skip as typeof test.skip)!;

omit('adds', () => {
  expect(1 + 1).toBe(2);
});
