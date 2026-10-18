import { expect } from 'vitest';
import { test } from '../support/test';

test('adds', () => {
  expect(1 + 1).toBe(2);
});

test('subtracts', () => {
  expect(2 - 1).toBe(1);
});
