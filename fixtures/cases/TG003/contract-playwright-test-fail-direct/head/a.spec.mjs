import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test.fail('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
