import { test, expect } from '@playwright/test';
const first = test['fail'];
const mark = first;
test('X', () => {
  expect(1).toBe(2);
});
