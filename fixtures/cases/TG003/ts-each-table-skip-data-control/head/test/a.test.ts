import { expect, it } from 'vitest';

it('adds', () => {
  expect(1 + 1).toBe(2);
});

it.each([
  ['skip', 'SKIP'],
  ['only', 'ONLY'],
])('upper %s', (word, upper) => {
  expect(word.toUpperCase()).toBe(upper);
});
