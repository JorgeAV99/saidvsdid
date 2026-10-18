import { expect, test } from 'vitest';

test('X', (ctx) => {
  for (const _ of []) {
    void _;
  }
  expect(1).toBe(1);
});
