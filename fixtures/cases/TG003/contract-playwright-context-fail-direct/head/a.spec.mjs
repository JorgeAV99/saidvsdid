import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test('adds', ({}, testInfo) => {
  testInfo.fail();
  if (1 + 1 !== 2) throw new Error('sum');
});
