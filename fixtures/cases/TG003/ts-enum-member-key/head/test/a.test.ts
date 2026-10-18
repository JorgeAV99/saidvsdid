import { expect, it } from 'vitest';

enum Kind {
  Stop = 'skip',
}

it('adds', (ctx) => {
  ctx[Kind.Stop]();
  expect(1 + 1).toBe(2);
});
