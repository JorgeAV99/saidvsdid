import { expect, test } from 'vitest';
import { validateAmount } from './validate';

test('accepts positive amounts', () => {
  expect(validateAmount(10)).toBe(10);
});

test('validateAmount is defined', () => {
  expect(validateAmount).toBeDefined();
});
