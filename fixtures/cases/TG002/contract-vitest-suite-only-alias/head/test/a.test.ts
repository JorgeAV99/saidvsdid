import { describe, test } from 'vitest';

const later = describe.only;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
