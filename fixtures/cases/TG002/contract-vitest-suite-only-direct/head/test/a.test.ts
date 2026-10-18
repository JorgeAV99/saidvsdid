import { describe, test } from 'vitest';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

describe.only('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
