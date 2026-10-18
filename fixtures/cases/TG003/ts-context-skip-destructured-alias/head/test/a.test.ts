import { expect, test } from 'vitest';

test('adds', ({ skip: omit }) => {
  omit();
  expect(1 + 1).toBe(2);
});
