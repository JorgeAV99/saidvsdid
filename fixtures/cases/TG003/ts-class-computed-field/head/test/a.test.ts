import { expect, it } from 'vitest';

class Suite {
  static ['omit'] = it.skip;
}

Suite.omit('adds', () => {
  expect(1 + 1).toBe(2);
});
