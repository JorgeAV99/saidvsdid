import { expect, test } from '@playwright/test';

test('home has a title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Home/);
});
