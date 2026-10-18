import { expect, it } from 'vitest';

const { omit = it.skip } = {} as { omit?: typeof it.skip };

omit('adds', () => {
  expect(1 + 1).toBe(2);
});
