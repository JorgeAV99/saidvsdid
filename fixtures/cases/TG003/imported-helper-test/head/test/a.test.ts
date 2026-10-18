import { expect } from 'vitest';
import { test } from '../support/test';

test.skip('adds', () => {
  expect(1 + 1).toBe(2);
});
