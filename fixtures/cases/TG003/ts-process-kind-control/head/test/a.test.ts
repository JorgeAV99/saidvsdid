import { expect, it } from 'vitest';

const kind = 'skip';
const procesar = (k: string) => k.toUpperCase();

it('adds', () => {
  procesar(kind);
  expect(1 + 1).toBe(2);
});
