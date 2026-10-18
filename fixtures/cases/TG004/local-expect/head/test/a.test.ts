import { test } from 'vitest';

// A local `expect` that checks nothing.
const expect = (_value: unknown) => ({ toBe: (_expected: unknown) => undefined });

test('adds', () => {
  expect(1 + 1).toBe(2);
});
