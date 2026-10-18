import { expect, test } from '@playwright/test';

test('X', async () => {
  test.setTimeout(10);
  await new Promise(() => {});
});
