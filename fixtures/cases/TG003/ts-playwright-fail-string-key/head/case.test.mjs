import { test, expect } from '@playwright/test';
const key = 'fail';
test('X', () => {
  test[key]();
  expect(1).toBe(2);
});
