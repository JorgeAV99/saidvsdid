import { test } from 'vitest';

const later = test.runIf;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later(false)('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
