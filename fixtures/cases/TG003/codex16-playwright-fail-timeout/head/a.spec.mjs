import { expect, test } from '@playwright/test';

test.fail('X', async () => {
  test.setTimeout(10);
  await new Promise(() => {});
});
