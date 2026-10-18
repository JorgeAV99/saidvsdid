import { expect, test } from '@playwright/test';

// Kept for local debugging; not called anywhere.
function skipEverything() {
  test.skip();
}

const skipOnWebkit = (browserName: string) => {
  test.skip(browserName === 'webkit', 'flaky on webkit');
};

test.describe('login', () => {
  test('shows the form', async ({ page }) => {
    await page.goto('/login');
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
