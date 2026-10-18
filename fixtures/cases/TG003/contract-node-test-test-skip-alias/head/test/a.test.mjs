import { test } from 'node:test';

const later = test.skip;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
