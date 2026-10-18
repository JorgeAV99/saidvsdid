import { expect, test } from 'vitest';

test.fails('X', () => {
  expect(1).toBe(1);
});
