import { expect, it } from 'vitest';

class Suite {
  static ['omit'] = it.skip;
}

it('adds', () => {
  expect(1 + 1).toBe(2);
});
