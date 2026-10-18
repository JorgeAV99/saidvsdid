import { expect, it } from 'vitest';

enum Kind {
  Stop = 'skip',
}

it('adds', (ctx) => {
  expect(1 + 1).toBe(2);
});
