import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', () => {
  test.fixme();
  if (1 + 1 !== 2) throw new Error('sum');
});
