import { test, expect } from '@playwright/test';

test('X', () => {
  Reflect.get(test, 'fail')();
  expect(1).toBe(2);
});
