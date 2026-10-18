import { expect, test } from 'vitest';

const absent: ((x: unknown) => void) | null = null;

test('X', (ctx) => {
  absent?.(ctx.skip());
  expect(1).toBe(1);
});
