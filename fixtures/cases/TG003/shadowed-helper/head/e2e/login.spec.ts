import { expect, test } from '@playwright/test';

function prepare() {
  test.skip();
}

test.describe('login', () => {
  test('shows the form', async ({ page }) => {
    function prepare() {
      return page.goto('/login');
    }
    await prepare();
    await expect(page.getByRole('form')).toBeVisible();
  });

  test('rejects a bad password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });
});

test('home loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Home/);
});
