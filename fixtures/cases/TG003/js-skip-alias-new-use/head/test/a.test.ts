import { expect, test } from 'vitest';

const omit = test.skip;

omit('a', () => {
  expect(1 + 1).toBe(2);
});

omit('b', () => {
  expect(2 + 2).toBe(4);
});
