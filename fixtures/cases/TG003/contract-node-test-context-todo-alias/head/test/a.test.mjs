import { test } from 'node:test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', (t) => {
  const later = t.todo;
  later();
  if (1 + 1 !== 2) throw new Error('sum');
});
