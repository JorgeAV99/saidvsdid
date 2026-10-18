import * as vitest from 'vitest';

const { it, expect } = vitest;

it.skipIf(true)('adds', () => {
  expect(1 + 1).toBe(2);
});
