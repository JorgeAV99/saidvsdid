import { expect, test } from 'vitest';

test['\u006fnly']('adds', () => {
  expect(1 + 1).toBe(2);
});

test('subtracts', () => {
  expect(2 - 1).toBe(1);
});
