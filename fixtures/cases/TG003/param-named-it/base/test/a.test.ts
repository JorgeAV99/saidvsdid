import { describe, expect, test } from 'vitest';

const runner = Object.assign((name: string, fn: () => void) => test(name, fn), {
  skip: (name: string, fn: () => void) => test(name, fn),
  only: (name: string, fn: () => void) => test(name, fn),
});

// vitest passes one argument to a describe factory: `it`, the second parameter, is this default.
describe('group', (_test, it = runner) => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
});
