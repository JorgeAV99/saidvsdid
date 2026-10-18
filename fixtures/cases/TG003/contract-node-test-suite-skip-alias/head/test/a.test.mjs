import { describe, test } from 'node:test';

const later = describe.skip;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
