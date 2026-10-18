import { test, expect } from '@playwright/test';
const first = test.fail;
const mark = first;
test('X', () => {
  mark();
  expect(1).toBe(2);
});
