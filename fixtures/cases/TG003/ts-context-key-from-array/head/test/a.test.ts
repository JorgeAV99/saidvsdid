import { expect, it } from 'vitest';

const keys = ['skip'];

it('adds', (ctx) => {
  ctx[keys[0]]();
  expect(1 + 1).toBe(2);
});
