import { test } from '@playwright/test';

test('other', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});

test.fixme('adds', () => {
  if (1 + 1 !== 2) throw new Error('sum');
});
