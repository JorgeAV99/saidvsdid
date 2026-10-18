import { expect, test } from 'vitest';

// A project helper that happens to be called `it`: its `skip` still runs the test.
const it = Object.assign((name: string, fn: () => void) => test(name, fn), {
  skip: (name: string, fn: () => void) => test(name, fn),
  only: (name: string, fn: () => void) => test(name, fn),
});

it.skip('adds', () => {
  expect(1 + 1).toBe(2);
});
