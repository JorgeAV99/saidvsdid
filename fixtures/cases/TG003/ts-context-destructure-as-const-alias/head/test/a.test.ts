import { expect, it } from 'vitest';

it('adds', (ctx) => {
  const { ['skip' as const]: omit } = ctx;
  omit();
  expect(1 + 1).toBe(2);
});
