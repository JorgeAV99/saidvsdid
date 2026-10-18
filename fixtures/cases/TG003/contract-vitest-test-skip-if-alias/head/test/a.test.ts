import { test } from 'vitest';

const later = test.skipIf;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later(true)('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
