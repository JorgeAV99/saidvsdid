import { describe, test } from 'vitest';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

describe.skipIf(true)('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
