import { expect, it } from 'vitest';

const omit = it.skip;
const later = omit;

omit('a', () => {
  expect(1 + 1).toBe(2);
});

later('b', () => {
  expect(2 + 2).toBe(4);
});
