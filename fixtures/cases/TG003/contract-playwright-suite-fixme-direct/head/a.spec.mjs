import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test.describe.fixme('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
