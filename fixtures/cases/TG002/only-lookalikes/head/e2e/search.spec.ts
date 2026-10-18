import { expect, test } from '@playwright/test';

const only = <T>(xs: T[], pred: (x: T) => boolean): T[] => xs.filter(pred);

test.describe.configure({ mode: 'serial' });

test('search works', async ({ page }) => {
  await test.step('only the search box is focused', async () => {
    await page.goto('/');
    await expect.soft(page.getByRole('searchbox')).toBeFocused();
  });
  expect(only([1, 2, 3], (n) => n > 1)).toEqual([2, 3]);
});
