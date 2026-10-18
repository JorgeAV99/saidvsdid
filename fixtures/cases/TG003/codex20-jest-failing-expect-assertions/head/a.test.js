import { test, expect } from '@jest/globals';

test.failing('service', () => {
  expect.assertions(1);
  JSON.parse('{');
  expect(1).toBe(1);
});
