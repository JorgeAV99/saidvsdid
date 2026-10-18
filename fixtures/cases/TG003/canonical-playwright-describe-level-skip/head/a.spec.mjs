import { test } from '@playwright/test';

test.describe('group', () => {
  test.skip();
  test('adds', () => {
    if (1 + 1 !== 2) throw new Error('sum');
  });
});
