import { expect, test } from 'vitest';

namespace Helpers {
  export const api = Object.assign((name: string, fn: () => void) => test(name, fn), {
    skip: (name: string, fn: () => void) => test(name, fn),
  });
}

namespace Suite {
  export import test = Helpers.api;
  test.skip('adds', () => {
    expect(1 + 1).toBe(2);
  });
}
