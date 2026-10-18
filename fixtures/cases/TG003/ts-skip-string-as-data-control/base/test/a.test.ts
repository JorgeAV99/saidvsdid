import { expect, it } from 'vitest';

const kind = 'skip';
const cases = [{ name: 'a', status: 'skip' }];
const statusOf = (k: string = 'skip') => k.toUpperCase();
const first = (c = cases) => c[0];

it('adds', () => {
  expect(1 + 1).toBe(2);
});
