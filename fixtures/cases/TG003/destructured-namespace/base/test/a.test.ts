import * as vitest from 'vitest';

const { it, expect } = vitest;

it.skipIf(false)('adds', () => {
  expect(1 + 1).toBe(2);
});
