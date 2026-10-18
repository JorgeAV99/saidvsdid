import { expect, test } from 'vitest';
import * as V from 'vitest';

namespace Suite {
  export const test = Object.assign((name: string, fn: () => void) => V.test(name, fn), {
    skip: (name: string, fn: () => void) => V.test(name, fn),
  });
}

namespace Suite {
  test.skip('adds', () => {
    expect(1 + 1).toBe(2);
  });
}
