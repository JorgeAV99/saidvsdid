import { test } from 'vitest';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', { fails: true }, () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
