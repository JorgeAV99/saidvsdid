import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', () => {
  test.fail();
  if (1 + 1 !== 2) throw new Error('sum');
});
