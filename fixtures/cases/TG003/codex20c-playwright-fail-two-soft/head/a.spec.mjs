import { test, expect } from '@playwright/test';

test.fail('service', () => {
  expect.soft(1).toBe(2);
  expect.soft(3).toBe(4);
});
