import { expect, it } from 'vitest';

const kind = 'skip';
const procesar = (k: string) => k.toUpperCase();

it('adds', () => {
  expect(1 + 1).toBe(2);
});
