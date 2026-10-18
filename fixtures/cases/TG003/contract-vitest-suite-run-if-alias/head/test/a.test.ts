import { describe, test } from 'vitest';

const later = describe.runIf;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later(false)('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
