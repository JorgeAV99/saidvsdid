import { describe, test } from 'vitest';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

describe('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
