import { test, expect } from '@playwright/test';
const first = test.info;
const mark = first;
test('X', () => {
  mark();
  expect(1).toBe(1);
});
