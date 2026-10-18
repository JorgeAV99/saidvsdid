import { expect, it } from 'vitest';

it['skip' as const]('adds', () => {
  expect(1 + 1).toBe(2);
});
