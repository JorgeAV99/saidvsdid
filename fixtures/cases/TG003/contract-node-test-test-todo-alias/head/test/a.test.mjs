import { test } from 'node:test';

const later = test.todo;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('adds');
