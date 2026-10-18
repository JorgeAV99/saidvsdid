import { test, expect } from '@playwright/test';

test.describe.configure({ retries: 1 });

test('X', async ({}, info) => {
  expect(info.retry).toBe(0);
});
