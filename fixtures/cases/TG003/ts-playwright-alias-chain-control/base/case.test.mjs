import { test, expect } from '@playwright/test';
const first = test.info;
const mark = first;
test('X', () => {
  expect(1).toBe(1);
});
