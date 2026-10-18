import { expect, test } from 'vitest';

const absent: ((x: unknown) => void) | null = null;

test('X', (ctx) => {
  expect(1).toBe(1);
});

test('X', () => expect(1).toBe(1));
