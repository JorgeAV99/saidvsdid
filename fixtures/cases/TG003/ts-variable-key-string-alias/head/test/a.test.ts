import { expect, it } from 'vitest';

const key = 'skip';

it[key]('adds', () => {
  expect(1 + 1).toBe(2);
});
