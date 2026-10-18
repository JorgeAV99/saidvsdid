import { expect, test } from '@playwright/test';

test.describe.only('login', () => {
  test('shows the form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('form')).toBeVisible();
  });

  test.describe('errors', () => {
    test('rejects a bad password', async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Password').fill('nope');
      await expect(page.getByText('Invalid credentials')).toBeVisible();
    });
  });
});
