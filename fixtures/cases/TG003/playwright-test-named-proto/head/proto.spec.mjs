import { test, expect } from '@playwright/test';
test.skip('__proto__', () => {
  expect(1).toBe(1);
});
test('other', () => {
  expect(1).toBe(1);
});
