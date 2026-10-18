import { test, expect } from '@jest/globals';

test('service', () => {
  expect.assertions(1);
  JSON.parse('{');
  expect(1).toBe(1);
});
