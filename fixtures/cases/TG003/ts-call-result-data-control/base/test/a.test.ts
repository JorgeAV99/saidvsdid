import { expect, it } from 'vitest';

const GOOD = { status: 'skip', path: ['pytest', 'mark', 'skip'] };
const check = (x: object) => ({ ...x, ok: true });

it('adds', () => {
  expect(1 + 1).toBe(2);
});
