import { expect, test } from '@playwright/test';

test('search works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('searchbox')).toBeVisible();
});
