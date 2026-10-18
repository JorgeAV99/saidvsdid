import { test } from '@playwright/test';

const later = test.describe.skip;

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

later('group', () => {
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
