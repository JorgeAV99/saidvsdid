import { expect, test } from 'vitest';

const it = test;

it.skipIf(true)('adds', () => {
  expect(1 + 1).toBe(2);
});
