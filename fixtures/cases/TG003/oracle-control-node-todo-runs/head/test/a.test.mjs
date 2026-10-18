import { test } from 'node:test';

test.todo('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
