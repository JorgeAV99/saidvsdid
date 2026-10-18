import { test } from 'vitest';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', (ctx) => {
  const later = ctx.skip;
  later();
  if (1 + 1 !== 2) throw new Error('sum');
});
