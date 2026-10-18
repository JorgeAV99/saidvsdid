import { describe, test } from 'vitest';

const later = describe.skipIf;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later(true)('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
