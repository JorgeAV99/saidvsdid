import { expect, test } from 'vitest';

test('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('other', () => {
  expect(2 + 2).toBe(4);
});
